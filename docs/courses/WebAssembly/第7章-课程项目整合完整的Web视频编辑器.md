# 第7章：课程项目整合——完整的 Web 视频编辑器

六 chapters 的积累，现在到了汇合的时刻。我们有图像管线（第2-3章）、实时帧处理（第4章）、性能优化手段（第5章）、编码导出能力（第6章）。本章要把这些模块整合成一个完整的 Web 视频编辑器——用户可以导入多个视频片段、在时间轴上排列它们、施加特效、添加转场、最终导出成片。回顾核心本质——"JS 管调度，Wasm 管计算"——这不再是单个模块的分工，而是整个编辑器架构的基石。

---

## 7.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   Web 视频编辑器                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  UI 层（JS + HTML/CSS）                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │ 素材面板  │  │ 预览窗口  │  │   时间轴编辑器  │  │   │
│  │  └──────────┘  └──────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  调度层（JS）                                      │   │
│  │  TimelineManager → FrameComposer → PipelineAPI    │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  计算层（Wasm + Worker）                           │   │
│  │  Pipeline → 滤镜处理 → 帧合成 → 编码               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

三层架构：UI 层负责展示和交互，调度层管理编辑状态和帧循环，计算层在 Worker 中执行像素处理。

---

## 7.2 时间轴数据模型

时间轴是视频编辑器的核心数据结构：

```javascript
// 时间轴数据模型
const timeline = {
    tracks: [
        {
            id: 'track-1',
            type: 'video',
            clips: [
                {
                    id: 'clip-1',
                    source: 'video-file-1',  // 指向源视频
                    sourceStart: 0,           // 源视频中的起始时间（秒）
                    sourceEnd: 10,            // 源视频中的结束时间（秒）
                    timelineStart: 0,         // 时间轴上的起始位置（秒）
                    duration: 10,             // 在时间轴上的持续时间
                    filters: {
                        brightness: 10,
                        contrast: 1.2,
                        saturation: 1.0,
                        grayscale: false,
                    },
                    transition: {
                        type: 'fade',         // 与下一个片段的转场
                        duration: 0.5,        // 转场持续时间（秒）
                    },
                },
                {
                    id: 'clip-2',
                    source: 'video-file-2',
                    sourceStart: 5,
                    sourceEnd: 20,
                    timelineStart: 9.5,       // = clip-1.timelineStart + clip-1.duration - transition.duration
                    duration: 15,
                    filters: { /* ... */ },
                    transition: null,
                },
            ],
        },
    ],
    duration: 24.5,  // 总时长
};
```

### 帧合成逻辑

给定时间轴上的一个时间点 `t`，合成逻辑需要：

1. 找到 `t` 时刻在哪些片段的范围内
2. 如果有转场重叠，计算混合权重
3. 提取对应帧，应用滤镜，按权重混合

```javascript
class TimelineManager {
    constructor(timeline) {
        this.timeline = timeline;
        this.sources = new Map(); // sourceId → HTMLVideoElement
    }

    registerSource(id, videoElement) {
        this.sources.set(id, videoElement);
    }

    // 合成指定时刻的帧
    async composeFrame(t, canvas, pipeline) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const track of this.timeline.tracks) {
            if (track.type !== 'video') continue;

            for (const clip of track.clips) {
                // 检查时间点是否在片段范围内
                if (t < clip.timelineStart || t >= clip.timelineStart + clip.duration) continue;

                // 计算源视频中的对应时间
                const clipProgress = (t - clip.timelineStart) / clip.duration;
                const sourceTime = clip.sourceStart + clipProgress * (clip.sourceEnd - clip.sourceStart);

                // 从源视频提取帧
                const video = this.sources.get(clip.source);
                await this.seekTo(video, sourceTime);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 应用滤镜
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const f = clip.filters;
                pipeline.set_filter(f.brightness, f.contrast, f.saturation, f.grayscale);
                pipeline.process_frame(imageData.data);
                ctx.putImageData(imageData, 0, 0);

                // 处理转场
                if (clip.transition) {
                    await this.applyTransition(clip, t, canvas, ctx);
                }

                break; // 每个轨道只处理一个片段（简化）
            }
        }
    }

    async applyTransition(clip, currentTime, canvas, ctx) {
        const transEnd = clip.timelineStart + clip.transition.duration;
        if (currentTime >= transEnd) return; // 转场已结束

        // 计算混合权重
        const alpha = (currentTime - clip.timelineStart) / clip.transition.duration;

        // 用 globalAlpha 实现淡入淡出
        // 这需要先保存当前帧，再获取前一个片段的帧，然后混合
        if (clip.transition.type === 'fade') {
            ctx.globalAlpha = alpha;
        }
    }

    seekTo(video, time) {
        return new Promise((resolve) => {
            video.currentTime = Math.max(0, time);
            video.addEventListener('seeked', resolve, { once: true });
        });
    }

    getTotalDuration() {
        let maxEnd = 0;
        for (const track of this.timeline.tracks) {
            for (const clip of track.clips) {
                maxEnd = Math.max(maxEnd, clip.timelineStart + clip.duration);
            }
        }
        return maxEnd;
    }
}
```

---

## 7.3 时间轴编辑器 UI

### 步骤一：HTML 结构

```html
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>Wasm 视频编辑器</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #eee; height: 100vh; display: flex; flex-direction: column; }

        /* 顶部工具栏 */
        .toolbar {
            display: flex; align-items: center; gap: 1rem;
            padding: 0.5rem 1rem; background: #16213e; border-bottom: 1px solid #333;
        }
        .toolbar button {
            padding: 0.4rem 0.8rem; border: 1px solid #555; border-radius: 4px;
            background: #0f3460; color: #eee; cursor: pointer; font-size: 0.85rem;
        }
        .toolbar button:hover { background: #1a5276; }
        .toolbar button:disabled { opacity: 0.4; cursor: default; }

        /* 中间区域：素材 + 预览 */
        .middle {
            display: flex; flex: 1; min-height: 0; overflow: hidden;
        }

        /* 素材面板 */
        .media-panel {
            width: 200px; padding: 0.5rem; background: #16213e;
            border-right: 1px solid #333; overflow-y: auto;
        }
        .media-panel h3 { font-size: 0.85rem; color: #aaa; margin-bottom: 0.5rem; }
        .media-item {
            padding: 0.4rem 0.6rem; margin-bottom: 0.3rem;
            background: #0f3460; border-radius: 4px; cursor: grab;
            font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* 预览区域 */
        .preview {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            background: #000; position: relative;
        }
        .preview canvas { max-width: 100%; max-height: 100%; }
        .preview-overlay {
            position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 0.5rem; align-items: center;
        }
        .preview-overlay button {
            padding: 0.3rem 0.6rem; border: 1px solid #555; border-radius: 4px;
            background: rgba(15, 52, 96, 0.8); color: #eee; cursor: pointer;
        }
        .time-display { font-family: monospace; font-size: 0.85rem; color: #aaa; }

        /* 滤镜控制面板 */
        .filter-panel {
            width: 220px; padding: 0.5rem; background: #16213e;
            border-left: 1px solid #333; overflow-y: auto;
        }
        .filter-panel h3 { font-size: 0.85rem; color: #aaa; margin-bottom: 0.5rem; }
        .filter-control { margin-bottom: 0.8rem; }
        .filter-control label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.2rem; }
        .filter-control input[type="range"] { width: 100%; }
        .filter-control .val { float: right; font-size: 0.75rem; color: #666; }

        /* 底部时间轴 */
        .timeline-area {
            height: 180px; background: #16213e; border-top: 1px solid #333;
            display: flex; flex-direction: column;
        }
        .timeline-ruler {
            height: 24px; background: #0f3460; position: relative; cursor: pointer;
        }
        .timeline-ruler .playhead {
            position: absolute; top: 0; width: 2px; height: 100%;
            background: #e74c3c; pointer-events: none;
        }
        .timeline-ruler .time-mark {
            position: absolute; top: 4px; font-size: 0.65rem; color: #888;
        }
        .timeline-tracks {
            flex: 1; overflow-y: auto; position: relative;
        }
        .timeline-track {
            height: 50px; position: relative; border-bottom: 1px solid #333;
        }
        .timeline-clip {
            position: absolute; top: 5px; height: 40px; border-radius: 4px;
            background: #2980b9; cursor: move; display: flex;
            align-items: center; padding: 0 0.5rem; font-size: 0.75rem;
            overflow: hidden; white-space: nowrap;
        }
        .timeline-clip .transition-zone {
            position: absolute; right: 0; top: 0; height: 100%; width: 30px;
            background: rgba(231, 76, 60, 0.3); border-left: 1px dashed rgba(231, 76, 60, 0.5);
        }

        /* 导出进度 */
        .export-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.7);
            display: flex; align-items: center; justify-content: center; z-index: 100;
        }
        .export-box {
            background: #16213e; padding: 2rem; border-radius: 8px; text-align: center;
        }
        .export-box progress { width: 300px; height: 20px; }
    </style>
</head>
<body>
    <!-- 工具栏 -->
    <div class="toolbar">
        <button id="importBtn">导入视频</button>
        <button id="addToTimelineBtn" disabled>添加到时间轴</button>
        <button id="exportBtn" disabled>导出 MP4</button>
        <input type="file" id="fileInput" accept="video/*" multiple hidden>
        <span class="time-display" id="statusText">就绪</span>
    </div>

    <!-- 中间区域 -->
    <div class="middle">
        <!-- 素材面板 -->
        <div class="media-panel">
            <h3>素材库</h3>
            <div id="mediaList"></div>
        </div>

        <!-- 预览 -->
        <div class="preview">
            <canvas id="previewCanvas"></canvas>
            <div class="preview-overlay">
                <button id="playBtn">▶</button>
                <button id="stopBtn">■</button>
                <span class="time-display" id="timeDisplay">00:00.00 / 00:00.00</span>
            </div>
        </div>

        <!-- 滤镜面板 -->
        <div class="filter-panel">
            <h3>滤镜调整</h3>
            <div class="filter-control">
                <label>亮度 <span class="val" id="brightnessVal">0</span></label>
                <input type="range" id="brightness" min="-128" max="128" value="0">
            </div>
            <div class="filter-control">
                <label>对比度 <span class="val" id="contrastVal">1.0</span></label>
                <input type="range" id="contrast" min="0" max="300" value="100">
            </div>
            <div class="filter-control">
                <label>饱和度 <span class="val" id="saturationVal">1.0</span></label>
                <input type="range" id="saturation" min="0" max="300" value="100">
            </div>
            <div class="filter-control">
                <button id="grayscaleBtn">灰度化</button>
                <button id="resetFilterBtn">重置</button>
            </div>
        </div>
    </div>

    <!-- 时间轴 -->
    <div class="timeline-area">
        <div class="timeline-ruler" id="timelineRuler">
            <div class="playhead" id="playhead"></div>
        </div>
        <div class="timeline-tracks" id="timelineTracks"></div>
    </div>
</body>
</html>
```

### 步骤二：编辑器核心逻辑

```javascript
// editor.js — 编辑器核心
export class VideoEditor {
    constructor(canvas, pipeline) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.pipeline = pipeline;

        this.sources = new Map();   // id → { video, name }
        this.clips = [];             // 时间轴上的片段列表
        this.currentTime = 0;
        this.duration = 0;
        this.isPlaying = false;
        this.animFrameId = null;

        this.selectedClipId = null;
        this.onTimeUpdate = null;
        this.onDurationChange = null;
    }

    // 导入视频素材
    async importVideo(file) {
        const id = `source-${Date.now()}`;
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.preload = 'auto';
        video.muted = true;

        await new Promise((resolve) => {
            video.addEventListener('loadedmetadata', resolve, { once: true });
        });

        this.sources.set(id, { video, name: file.name });
        return { id, name: file.name, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    }

    // 添加片段到时间轴
    addClip(sourceId, options = {}) {
        const source = this.sources.get(sourceId);
        if (!source) throw new Error('源视频不存在');

        const timelineStart = options.timelineStart ?? this.duration;
        const sourceStart = options.sourceStart ?? 0;
        const sourceEnd = options.sourceEnd ?? source.video.duration;
        const duration = sourceEnd - sourceStart;

        const clip = {
            id: `clip-${Date.now()}`,
            sourceId,
            sourceStart,
            sourceEnd,
            timelineStart,
            duration,
            filters: {
                brightness: 0,
                contrast: 1.0,
                saturation: 1.0,
                grayscale: false,
            },
            transition: options.transition ?? null,
        };

        this.clips.push(clip);
        this.recalculateDuration();
        return clip;
    }

    recalculateDuration() {
        let maxEnd = 0;
        for (const clip of this.clips) {
            maxEnd = Math.max(maxEnd, clip.timelineStart + clip.duration);
        }
        this.duration = maxEnd;
        if (this.onDurationChange) this.onDurationChange(this.duration);
    }

    // 获取指定时间的活跃片段
    getActiveClip(t) {
        for (const clip of this.clips) {
            if (t >= clip.timelineStart && t < clip.timelineStart + clip.duration) {
                return clip;
            }
        }
        return null;
    }

    // 渲染指定时间的帧
    async renderFrame(t) {
        this.currentTime = t;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const clip = this.getActiveClip(t);
        if (!clip) return;

        const source = this.sources.get(clip.sourceId);
        const progress = (t - clip.timelineStart) / clip.duration;
        const sourceTime = clip.sourceStart + progress * (clip.sourceEnd - clip.sourceStart);

        // Seek 并绘制
        await this.seekTo(source.video, sourceTime);
        this.ctx.drawImage(source.video, 0, 0, this.canvas.width, this.canvas.height);

        // 应用滤镜
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const f = clip.filters;
        this.pipeline.set_filter(f.brightness, f.contrast, f.saturation, f.grayscale);
        this.pipeline.process_frame(imageData.data);
        this.ctx.putImageData(imageData, 0, 0);

        // 转场混合
        if (clip.transition && t < clip.timelineStart + clip.transition.duration) {
            const alpha = (t - clip.timelineStart) / clip.transition.duration;
            // 淡入效果：在前一帧的基础上混合
            this.ctx.globalAlpha = 1 - alpha;
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.globalAlpha = 1.0;
        }

        if (this.onTimeUpdate) this.onTimeUpdate(t);
    }

    // 播放
    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        let lastTime = performance.now();

        const loop = async () => {
            if (!this.isPlaying) return;

            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;

            this.currentTime += dt;
            if (this.currentTime >= this.duration) {
                this.currentTime = 0;
            }

            await this.renderFrame(this.currentTime);
            this.animFrameId = requestAnimationFrame(loop);
        };

        this.animFrameId = requestAnimationFrame(loop);
    }

    pause() {
        this.isPlaying = false;
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    }

    stop() {
        this.pause();
        this.currentTime = 0;
        this.renderFrame(0);
    }

    seek(t) {
        this.currentTime = Math.max(0, Math.min(t, this.duration));
        this.renderFrame(this.currentTime);
    }

    seekTo(video, time) {
        return new Promise((resolve) => {
            video.currentTime = Math.max(0, time);
            const handler = () => {
                video.removeEventListener('seeked', handler);
                resolve();
            };
            video.addEventListener('seeked', handler);
        });
    }

    // 更新选中片段的滤镜
    updateSelectedFilter(filterName, value) {
        if (!this.selectedClipId) return;
        const clip = this.clips.find(c => c.id === this.selectedClipId);
        if (clip) {
            clip.filters[filterName] = value;
            if (!this.isPlaying) this.renderFrame(this.currentTime);
        }
    }

    selectClip(clipId) {
        this.selectedClipId = clipId;
        const clip = this.clips.find(c => c.id === clipId);
        if (clip) {
            // 同步滤镜面板
            return clip.filters;
        }
        return null;
    }
}
```

### 步骤三：主程序集成

```javascript
// main.js — 主程序入口
import init, { Pipeline } from './pkg/video_editor_engine.js';
import { VideoEditor } from './editor.js';
import { VideoExporter } from './exporter.js';

async function main() {
    await init();

    const canvas = document.getElementById('previewCanvas');
    const pipeline = new Pipeline(1920, 1080);
    const editor = new VideoEditor(canvas, pipeline);

    let isGrayscale = false;

    // 导入按钮
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', async (e) => {
        for (const file of e.target.files) {
            const info = await editor.importVideo(file);

            // 添加到素材列表
            const item = document.createElement('div');
            item.className = 'media-item';
            item.textContent = `${info.name} (${info.duration.toFixed(1)}s)`;
            item.dataset.sourceId = info.id;
            item.draggable = true;
            document.getElementById('mediaList').appendChild(item);

            // 设置 Canvas 尺寸
            canvas.width = info.width;
            canvas.height = info.height;

            document.getElementById('addToTimelineBtn').disabled = false;
        }
    });

    // 添加到时间轴
    document.getElementById('addToTimelineBtn').addEventListener('click', () => {
        const items = document.querySelectorAll('.media-item');
        for (const item of items) {
            const sourceId = item.dataset.sourceId;
            const clip = editor.addClip(sourceId);

            // 在时间轴上渲染片段
            renderTimelineClip(clip, item.textContent);
        }

        document.getElementById('exportBtn').disabled = false;
        updateTimelineRuler();
        editor.renderFrame(0);
    });

    // 播放控制
    document.getElementById('playBtn').addEventListener('click', () => {
        if (editor.isPlaying) {
            editor.pause();
            document.getElementById('playBtn').textContent = '▶';
        } else {
            editor.play();
            document.getElementById('playBtn').textContent = '⏸';
        }
    });

    document.getElementById('stopBtn').addEventListener('click', () => {
        editor.stop();
        document.getElementById('playBtn').textContent = '▶';
    });

    // 时间更新
    editor.onTimeUpdate = (t) => {
        updateTimeDisplay(t, editor.duration);
        updatePlayhead(t, editor.duration);
    };

    // 滤镜控制
    document.getElementById('brightness').addEventListener('input', (e) => {
        document.getElementById('brightnessVal').textContent = e.target.value;
        editor.updateSelectedFilter('brightness', parseInt(e.target.value));
    });
    document.getElementById('contrast').addEventListener('input', (e) => {
        const v = parseInt(e.target.value) / 100;
        document.getElementById('contrastVal').textContent = v.toFixed(2);
        editor.updateSelectedFilter('contrast', v);
    });
    document.getElementById('saturation').addEventListener('input', (e) => {
        const v = parseInt(e.target.value) / 100;
        document.getElementById('saturationVal').textContent = v.toFixed(2);
        editor.updateSelectedFilter('saturation', v);
    });
    document.getElementById('grayscaleBtn').addEventListener('click', () => {
        isGrayscale = !isGrayscale;
        editor.updateSelectedFilter('grayscale', isGrayscale);
        document.getElementById('grayscaleBtn').textContent = isGrayscale ? '取消灰度' : '灰度化';
    });
    document.getElementById('resetFilterBtn').addEventListener('click', () => {
        document.getElementById('brightness').value = 0;
        document.getElementById('contrast').value = 100;
        document.getElementById('saturation').value = 100;
        document.getElementById('brightnessVal').textContent = '0';
        document.getElementById('contrastVal').textContent = '1.00';
        document.getElementById('saturationVal').textContent = '1.00';
        isGrayscale = false;
        editor.updateSelectedFilter('brightness', 0);
        editor.updateSelectedFilter('contrast', 1.0);
        editor.updateSelectedFilter('saturation', 1.0);
        editor.updateSelectedFilter('grayscale', false);
    });

    // 时间轴点击
    document.getElementById('timelineRuler').addEventListener('click', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        editor.seek(ratio * editor.duration);
    });

    // 导出
    document.getElementById('exportBtn').addEventListener('click', async () => {
        editor.pause();
        const exporter = new VideoExporter(canvas.width, canvas.height, 30);

        try {
            document.getElementById('statusText').textContent = '正在导出...';

            // 导出时需要逐帧渲染时间轴
            const totalFrames = Math.ceil(editor.duration * 30);
            const mp4Buffer = await exporter.exportTimeline(
                editor,
                totalFrames,
                (current, total) => {
                    const pct = Math.round((current / total) * 100);
                    document.getElementById('statusText').textContent = `导出中 ${pct}%...`;
                }
            );

            VideoExporter.download(mp4Buffer, `编辑导出_${Date.now()}.mp4`);
            document.getElementById('statusText').textContent = '导出完成！';
        } catch (e) {
            document.getElementById('statusText').textContent = `导出失败: ${e.message}`;
        }
    });

    // 辅助函数
    function updateTimeDisplay(current, total) {
        const fmt = (s) => {
            const m = Math.floor(s / 60);
            const sec = (s % 60).toFixed(2);
            return `${m.toString().padStart(2, '0')}:${sec.padStart(5, '0')}`;
        };
        document.getElementById('timeDisplay').textContent = `${fmt(current)} / ${fmt(total)}`;
    }

    function updatePlayhead(t, duration) {
        const ruler = document.getElementById('timelineRuler');
        const playhead = document.getElementById('playhead');
        const ratio = duration > 0 ? t / duration : 0;
        playhead.style.left = `${ratio * 100}%`;
    }

    function renderTimelineClip(clip, label) {
        const tracks = document.getElementById('timelineTracks');
        let track = tracks.querySelector('.timeline-track');
        if (!track) {
            track = document.createElement('div');
            track.className = 'timeline-track';
            tracks.appendChild(track);
        }

        const el = document.createElement('div');
        el.className = 'timeline-clip';
        el.textContent = label.substring(0, 20);
        el.dataset.clipId = clip.id;

        // 位置和宽度按比例计算（暂定 100px = 1秒）
        const scale = 100;
        el.style.left = `${clip.timelineStart * scale}px`;
        el.style.width = `${clip.duration * scale}px`;

        // 点击选中
        el.addEventListener('click', () => {
            const filters = editor.selectClip(clip.id);
            if (filters) {
                document.getElementById('brightness').value = filters.brightness;
                document.getElementById('contrast').value = Math.round(filters.contrast * 100);
                document.getElementById('saturation').value = Math.round(filters.saturation * 100);
            }
            editor.seek(clip.timelineStart);
        });

        track.appendChild(el);
    }

    function updateTimelineRuler() {
        const ruler = document.getElementById('timelineRuler');
        // 添加时间刻度
        const duration = editor.duration;
        const step = duration > 60 ? 10 : duration > 20 ? 5 : 1;
        for (let t = 0; t <= duration; t += step) {
            const mark = document.createElement('span');
            mark.className = 'time-mark';
            mark.style.left = `${(t / duration) * 100}%`;
            mark.textContent = `${t}s`;
            ruler.appendChild(mark);
        }
    }
}

main();
```

---

## 7.4 运行整合项目

```bash
# 构建优化版 Wasm
RUSTFLAGS='-C target-feature=+simd128' wasm-pack build --target web --release
wasm-opt -O3 --enable-simd -o pkg/video_editor_engine_bg.wasm pkg/video_editor_engine_bg.wasm

# 安装前端依赖
npm install mp4-muxer

# 启动服务器
python3 -m http.server 8080
```

打开 `http://localhost:8080`，你会看到：

1. **素材面板**（左侧）：导入视频文件
2. **预览窗口**（中间）：实时预览编辑效果
3. **滤镜面板**（右侧）：调整选中片段的滤镜参数
4. **时间轴**（底部）：显示片段排列，点击跳转

操作流程：导入视频 → 添加到时间轴 → 在时间轴上点击选择片段 → 调整滤镜 → 播放预览 → 导出 MP4

---

## 7.5 回顾：Wasm 在整个架构中的角色

```
用户操作
    ↓
JS UI 事件处理
    ↓
TimelineManager（调度）: 哪个片段？什么时间？什么滤镜？
    ↓
Pipeline.set_filter()  ← 设置参数（微秒级）
Pipeline.process_frame(data)  ← 像素处理（毫秒级）
    ↓
Canvas 显示 / VideoEncoder 导出
```

Wasm 在这个架构中做了一件事：**以接近原生的速度处理像素**。所有其他事情——UI 交互、时间轴管理、文件读写、编码封装——都是 JS 的工作。

这正是 WebAssembly 的设计哲学：**不是要替代 JavaScript，而是补上 JS 做不好的那块拼图。**

### 性能复盘

| 操作 | 耗时（1080p） | 瓶颈 |
|------|-------------|------|
| `set_filter()` | < 0.01ms | 无 |
| `process_frame()` | 5-15ms（SIMD 优化后） | CPU 计算 |
| `getImageData()` | 1-3ms | GPU→CPU 传输 |
| `putImageData()` | 1-2ms | CPU→GPU 传输 |
| `drawImage(video)` | < 1ms | 硬件解码 |
| 编码（导出） | ~3-5ms/帧 | 硬件编码 |
| **单帧总计** | **~10-25ms** | |
| **可达帧率** | **40-100fps** | |

优化前（第4章）：18-25ms 纯 Wasm 处理。优化后：5-15ms。主要来自 SIMD 自动向量化（2-3x 提速）和编译优化（LTO + wasm-opt）。

---

## 7.6 这个项目的局限

诚实地讲，这个编辑器离生产可用还有明显差距：

| 层面 | 当前状态 | 生产级需要 |
|------|---------|-----------|
| 多轨支持 | 单轨 | 视频+音频+文字多轨 |
| 音频处理 | 无（视频静音） | 音频混音、音量调节 |
| 转场效果 | 简单淡入淡出 | 丰富的转场库 |
| 撤销/重做 | 无 | 完整的命令历史 |
| 拖拽编辑 | 仅点击选择 | 时间轴拖拽移动、裁剪 |
| 性能 | 单 Worker | 多 Worker 并行 + OffscreenCanvas |
| 文件管理 | 全部内存 | IndexedDB 持久化 + 流式处理 |

但核心目标已经达成：**你理解了 Wasm 在浏览器中处理视频的完整链路**。从像素级操作到管线架构，从实时预览到编码导出——这条路径可以扩展到任何计算密集型 Web 应用。

---

## 章末思考题

**题目一**：当前架构中，`editor.js` 的 `renderFrame()` 方法是异步的（因为 `seekTo` 是异步的）。但在 `play()` 的帧循环中，我们用 `await this.renderFrame()` 来逐帧处理。如果 `renderFrame` 耗时超过帧预算（33ms），会发生什么？有没有更好的帧调度方式？

**参考答案**：

当前实现中，如果 `renderFrame` 超时，帧循环会自然降速——下一帧的 `requestAnimationFrame` 会在 `renderFrame` 完成后才注册。这不会崩溃，但会导致帧率不稳定（时快时慢）。

更好的方式是**解耦渲染和帧调度**：

```javascript
// 方案：跳帧保节奏
play() {
    const fps = 30;
    const frameInterval = 1000 / fps;
    let lastFrameTime = 0;

    const loop = (timestamp) => {
        if (!this.isPlaying) return;

        if (timestamp - lastFrameTime >= frameInterval) {
            this.currentTime += frameInterval / 1000;
            if (this.currentTime >= this.duration) this.currentTime = 0;

            // 不 await —— 让渲染在后台进行
            this.renderFrame(this.currentTime);
            lastFrameTime = timestamp;
        }

        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
```

关键改变：不再 await `renderFrame`，让它异步完成。这样帧调度保持稳定节奏，如果渲染跟不上就跳帧——**流畅度优先于完整性**。

---

**题目二**：如果把时间轴上的片段从 2 个增加到 20 个，每个片段滤镜参数不同，当前架构的 `renderFrame` 需要在每帧都 seek 到不同位置。`<video>` 元素的 seek 性能会随着片段数量增加而下降吗？有什么替代方案？

**参考答案**：

会下降。`<video>` 的 seek 每次都涉及解码器重置和帧定位。频繁 seek 不仅慢，还可能导致解码器内部缓冲区抖动。

替代方案：

1. **预解码到内存**：导入时把所有视频帧解码为原始 RGBA 数据存在内存中。1080p 30fps 的 10 秒视频约 2.4GB，可以用 IndexedDB + 缓存策略管理。
2. **VideoDecoder API**：用 WebCodecs 的 `VideoDecoder` 直接控制解码过程，按需解码指定帧，避免 `<video>` 的黑盒行为。
3. **帧缓存**：对最近访问的帧做 LRU 缓存。编辑器中用户通常反复查看同一段内容，缓存命中率可以很高。

方案 2 是最优的——它保留了按需解码（不占大量内存），同时给了我们精确的帧级控制。

---

**题目三**：回顾整个课程，我们用 Rust 编写了 Wasm 模块，用 JS 编写了 UI 和调度逻辑。如果让你重新设计，有哪些部分你会选择用纯 JS 实现（不用 Wasm），哪些坚持用 Wasm？判断标准是什么？

**参考答案**：

**坚持用 Wasm**：
- 像素级滤镜处理（灰度、亮度、对比度、饱和度）——计算密集，类型稳定，受益于 SIMD
- 未来可能添加的空间滤镜（模糊、锐化）——需要读取邻域像素，计算量大
- 视频编解码中的计算密集部分（如果不用 WebCodecs 硬件编码）

**用纯 JS 更合适**：
- 时间轴数据管理和帧调度——逻辑复杂但计算量小，JS 的灵活性更合适
- UI 渲染和交互——需要频繁访问 DOM，Wasm 无法直接操作
- 文件管理和缓存策略——大量异步 I/O，JS 的 async/await 更自然

判断标准回到核心本质：**计算密集、数据密集、逻辑简单且稳定** → Wasm；**I/O 密集、需要浏览器 API、逻辑复杂多变** → JS。

一个可能出乎意料的结论：如果滤镜只有简单的亮度和对比度调整（不涉及空间滤镜），现代 JS 引擎（V8 TurboFan）经过 JIT 优化后可能只比 Wasm 慢 2-3 倍——在 1080p 下也能达到 30fps。**Wasm 的价值在复杂计算场景中才真正显现**——模糊、编码、物理模拟等。简单操作用 JS 可能就够了，不必为了用 Wasm 而用 Wasm。
