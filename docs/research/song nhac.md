1) Những điểm mạnh đang làm đúng

Chia phase theo năng lực (canvas/layers/editors/audio/export) giúp kiểm soát độ phức tạp.

LayerManagerService + helper là nền tảng tốt để sau này có preset/undo/redo.

Đã nghĩ đến Butterchurn/AudioMotion sớm → chứng tỏ bạn hiểu “visualization không chỉ là vẽ, mà là pipeline audio→frame”.

2) Những điểm cần “khóa thiết kế” sớm (nếu không sẽ phát sinh rất nhiều bug)
A. Nguồn sự thật (Single Source of Truth) giữa Fabric và ProjectConfig

Đây là chỗ hay toang nhất.

Rủi ro thường gặp

Fabric object thay đổi liên tục (drag/scale/rotate), nếu bạn “sync từng pixel” về ProjectConfig sẽ gây:

giật lag, state update quá nhiều

vòng lặp cập nhật (Fabric → Config → render lại Fabric → lại đổi)

Không thống nhất hệ tọa độ: canvas zoom/pan, DPR, originX/originY, group transform.

Khuyến nghị

Chốt 1 trong 2 mô hình:

ProjectConfig là source of truth, Fabric chỉ là “view”: mọi thay đổi từ Fabric đi qua một “transaction” rồi commit về config (debounce/raf).

Fabric là source of truth khi thao tác, chỉ commit về config khi “mouseup / object:modified”.

Dùng cơ chế “patch/transaction” thay vì ghi đè nguyên object.

Quy định rõ: position/scale/rotation lưu theo canvas logical units (không phụ thuộc DPI).

B. Serialization / Deserialization (để preset + export + reload)

Đừng đợi đến Phase 9 mới làm, vì nếu làm muộn bạn sẽ phải refactor hàng loạt.

Vấn đề phát sinh

Fabric JSON không đủ “business data” (layer id, loại layer, metadata, effect params).

Thư viện visualization có state riêng (shader params/preset).

Text effects (gradient/multi-shadow) thường không serialize “native”.

Khuyến nghị

Thiết kế schema LayerModel sớm (id, type, zIndex, transform, style, effects, locked/hidden…)

Mỗi layer có:

toFabricObject() và fromFabricObject() (hoặc adapter)

serialize() và deserialize() độc lập Fabric.

C. Undo/Redo & History (nên xuất hiện sớm, không phải “polish”)

Khi đã có drag/text editor, thiếu undo/redo là cực khó dùng.

Rủi ro

Nếu bạn để đến cuối, các hành động đã rải rác nhiều nơi, rất khó gom lại.

Khuyến nghị

Tạo Command pattern hoặc History stack ngay trong Phase 4–5:

MoveLayerCommand, UpdateTextStyleCommand, AddLayerCommand, DeleteLayerCommand…

Chỉ cần bản tối thiểu: undo/redo cho add/delete/move/resize/edit text.

3) Nhận xét từng Phase + vấn đề phát sinh chi tiết
Phase 4: Drag & Drop trên Canvas

Các vấn đề hay gặp

Z-index & hit-test: layer nằm dưới bị “ăn click” bởi layer trên, cần lock/selectable/evented hợp lý.

Guides/snap:

snap theo grid vs snap theo object edges/center (Avee-like)

cần “tolerance” và hiển thị guideline

Multi-select:

Fabric group selection có nhiều góc cạnh: scaling nhóm làm thay đổi từng object khác nhau

Performance: object:modified bắn nhiều event khi drag.

Gợi ý kỹ thuật

Update ProjectConfig chỉ khi:

object:moving → update UI overlay (không commit)

object:modified/mouse:up → commit transform vào config

Debounce commit theo requestAnimationFrame.

Có “lock layer” thật sự (selectable=false, evented=false).

Phase 5: Text Editor Component

Đây là phase “đẹp nhưng nguy hiểm”.

Rủi ro lớn

Font loading (Google Fonts): tải font chậm, reflow text, mismatch khi export.

Text metrics: lineHeight, letterSpacing, alignment trong canvas không giống CSS 100%.

Gradient + stroke + multi-shadow + glow:

Fabric hỗ trợ một phần, còn lại phải custom render hoặc filter

multi-shadow thường phải vẽ nhiều lần / cache

International text (VN/JP/CN): font fallback, đo width, kerning.

Khuyến nghị

Chốt MVP cho text editor trước:

font family, size, color, alignment, stroke 1 lớp, shadow 1 lớp

Các hiệu ứng nâng cao (multi-shadow, glow pulse, gradient phức tạp) đẩy sang Phase 7, nhưng:

bạn nên chốt data model cho effects ngay từ Phase 5 để khỏi đổi schema.

Phase 6: Image Upload & Management

Bạn có IPC selectImageFile → khả năng là Electron.

Vấn đề phát sinh

Đường dẫn file local: app restart, path đổi, quyền truy cập.

Bảo mật: không nên load trực tiếp file path tùy ý vào renderer nếu không kiểm soát.

Memory: ảnh lớn (4K/8K) làm canvas nặng, lag khi drag/scale.

Cross-origin / tainted canvas nếu có ảnh từ URL (khi export).

Khuyến nghị

Chuẩn hóa asset pipeline:

copy asset vào workspace/project folder + hash name

lưu metadata (width/height, original path, createdAt)

Tạo thumbnail riêng để list layer nhẹ.

Có “max texture size”/downscale khi import (có toggle giữ nguyên).

Phase 7: Text Effects & Animations

Rủi ro

GSAP animate DOM dễ, nhưng canvas/fabric thì bạn phải tự “tick & render”.

Beat sync: nếu không có “clock” ổn định, animation bị lệch nhịp.

Khuyến nghị

Tạo Render Loop / Timeline abstraction:

currentTime, audioTime, fps, frameIndex

layer có update(time, audioFeatures) → render

Beat detection: cần “smoothing + hysteresis” để tránh nhấp nháy.

Phase 8: Advanced Visualizations (WebGL/particles/3D)

Vấn đề phát sinh

Mixing 2 renderer: Fabric (2D canvas) + WebGL (butterchurn/three/pixi)

compositing layer order (WebGL dưới, text trên?)

capture/export: phải đảm bảo bạn render ra một frame thống nhất.

WebGL context lost, GPU khác nhau.

Khuyến nghị

Xác định sớm kiến trúc:

Background visualization (WebGL) → render to canvas/texture

Overlay layers (Fabric) → render trên

Có fallback nếu WebGL fail.

Phase 9: Preset System

Preset chỉ ngon khi schema ổn định + serialization chuẩn.

Vấn đề phát sinh

Versioning preset: sau này bạn đổi schema là preset cũ hỏng.

Sharing: cần sanitize (không chứa file path nội bộ), chỉ ref asset id.

Khuyến nghị

Preset JSON có:

version, appVersion, schemaVersion

assets: danh sách asset refs + mapping

layers: layer models

visualization: preset params

Phase 10: Audio Features

Vấn đề phát sinh

Nhiều audio sources: sync time giữa sources, latency.

Audio effects (reverb/delay) ăn CPU, khác biệt browser.

Frequency band isolation: phải làm FFT ổn định, smoothing, windowing.

Khuyến nghị

Xác định “audio feature contract”:

rms, peak, bands[low/mid/high], spectrum[], beat, bpm estimate

Tách audio analysis ra worker nếu nặng.

Phase 11: Performance Optimization

Vấn đề phát sinh

Canvas nhiều object + shadow/glow = nặng.

Fabric caching sai chỗ → blur/scale artifacts hoặc tốn RAM.

Export thường chậm hơn realtime.

Khuyến nghị

Có 3 chế độ render:

Editor realtime (giảm chất lượng effects)

Preview quality (gần đúng)

Export quality (full)

Dùng OffscreenCanvas/Worker cho export nếu kiến trúc cho phép.

Phase 12: Export Improvements

Đây là phase bạn nên “chạm” sớm hơn dù chỉ MVP.

Vì sao?

Export là nơi lòi ra toàn bộ vấn đề: font loading, tainted canvas, sync audio/video, fps ổn định, compositing WebGL + Fabric.

Khuyến nghị

Làm “Vertical Slice Export” sớm:

1 visualization + 1 text layer + 1 image layer → xuất 5 giây video

Nếu export pipeline ổn, các phase sau sẽ ít bất ngờ.

4) Điều chỉnh thứ tự để giảm rủi ro (gợi ý)

Bạn vẫn giữ roadmap, nhưng nên “cài cọc” vài thứ sớm:

Phase 4: Drag & Drop + commit-on-modified + basic guides

Ngay sau Phase 4: History (Undo/Redo) MVP

Phase 5: Text editor MVP (ít effects) + font loading strategy

Chèn một mini-phase: Export MVP 5–10s (trước khi effects nặng)

Phase 6–7: image + effects + animation + beat sync

Phase 9: preset (lúc này schema đã ổn)

5) Checklist “đinh” nên có để tránh phát sinh về sau

 Quy ước coordinate system, anchor/origin, unit scale, DPR handling

 Layer schema + versioning từ sớm

 Adapter Fabric ↔ LayerModel + serialize/deserialize

 Undo/Redo command stack (MVP)

 Render loop/timebase chuẩn (editor + export dùng chung)

 Asset pipeline (import/copy/hash/thumbnail)

 Font loading & embed strategy cho export

 Export MVP sớm để lộ vấn đề hệ thống

 Chế độ quality (editor/preview/export)

Nếu bạn muốn, mình có thể viết giúp bạn một “bản thiết kế kỹ thuật 1 trang” (architecture blueprint) cho pipeline:
Audio → Analysis → RenderLoop → (WebGL background + Fabric overlay) → Export, kèm cách sync ProjectConfig và schema layer/preset sao cho ít refactor nhất.
Dưới đây là bản thiết kế kỹ thuật 1 trang (Architecture Blueprint) cho hệ thống: Audio → Analysis → RenderLoop → (WebGL background + Fabric overlay) → Export, kèm cách sync ProjectConfig, schema layer/preset, và giảm refactor về sau.

0) Mục tiêu & nguyên tắc

Mục tiêu

Editor realtime mượt (drag/scale/text edit).

Dễ mở rộng: effects/animations/beat-sync/presets/export.

Export đúng 1:1 với preview (hoặc “quality tier” rõ ràng).

Nguyên tắc

Single Source of Truth cho project data (ProjectConfig/ProjectState).

Fabric/WebGL chỉ là render/view layer, không “ôm” logic business.

Update từ UI/canvas đi qua Transaction/Command → dễ undo/redo + preset.

1) Sơ đồ tổng thể
              ┌──────────────────┐
Audio Source →│ AudioEngine       │→ audioTime
              │ (WebAudio/Tone)   │
              └───────┬──────────┘
                      │
                      v
              ┌──────────────────┐
              │ AudioAnalysis     │→ features (spectrum/bands/beat)
              │ (FFT + smoothing) │
              └───────┬──────────┘
                      │
                      v
┌──────────────┐  tick(time,features)  ┌─────────────────────────────┐
│ ProjectStore  │<─────────────────────│ RenderLoop / Timeline        │
│ (Config+State)│   dispatch(commands) │ (requestAnimationFrame)      │
└──────┬───────┘                      └───────────┬─────────────────┘
       │                                           │
       │ build render graph                         │
       v                                           v
┌──────────────────┐                    ┌────────────────────────────┐
│ WebGL Renderer     │ (background)      │ Fabric Renderer (overlay)  │
│ (butterchurn/3js)  │──────────────────▶│ text/image layers          │
└──────────────────┘   compositing      └────────────────────────────┘
                      (single frame)
                              │
                              v
                      ┌────────────────┐
                      │ Export Pipeline │ (offscreen/worker)
                      └────────────────┘

2) “Source of Truth” & chiến lược sync (chốt ngay từ Phase 4)
Chọn mô hình khuyến nghị: ProjectStore là truth, Fabric là “interactive view”

Khi kéo thả/resize/rotate:

Trong lúc thao tác: update tạm vào “LiveInteractionState” (không commit ProjectConfig liên tục)

Khi thả chuột (object:modified / mouse:up): commit 1 transaction vào ProjectStore

Tại sao?

Tránh vòng lặp: Fabric → Config → re-render Fabric → Fabric đổi tiếp

Giảm spam state update, mượt hơn

Quy tắc commit

object:moving → chỉ update overlay/guides, không ghi ProjectConfig

object:modified → dispatch(UpdateLayerTransformCommand)

Có rafThrottle cho việc “preview commit” nếu bạn muốn realtime config (optional)

3) Data Model (Schema) – thiết kế để ăn được Preset/Export/Undo
Core Schema đề xuất
type ProjectConfig = {
  version: number;          // schemaVersion
  canvas: { width: number; height: number; fps: number; };
  audio: { sourceId: string; bpmHint?: number; };
  visualization: { engine: "butterchurn" | "three" | "pixi"; presetId: string; params: any; };
  assets: Record<string, AssetRef>;
  layers: LayerModel[];     // z-order = array order
};

type AssetRef = {
  id: string;
  kind: "image" | "audio";
  uri: string;              // internal workspace path / blob id (không lưu absolute path OS)
  meta: { w?: number; h?: number; duration?: number; };
  hash?: string;            // tránh trùng
  thumbUri?: string;
};

type LayerModel =
  | TextLayerModel
  | ImageLayerModel
  | VizLayerModel;          // nếu bạn muốn viz cũng là 1 layer

type BaseLayer = {
  id: string;
  name: string;
  type: "text" | "image" | "viz";
  visible: boolean;
  locked: boolean;
  opacity: number;          // 0..1
  blendMode?: string;       // future
  transform: {
    x: number; y: number; rotation: number;
    scaleX: number; scaleY: number;
    origin: "center";       // chốt 1 origin để khỏi lệch
  };
  effects?: EffectPack;     // schema sẵn cho Phase 7
  animation?: AnimationPack;// schema sẵn cho beat-sync
};

type TextLayerModel = BaseLayer & {
  type: "text";
  text: string;
  style: {
    fontFamily: string; fontSize: number; fontWeight?: number;
    fill: string; align: "left"|"center"|"right";
    lineHeight?: number; letterSpacing?: number;
    stroke?: { color: string; width: number; };
    shadow?: { color: string; blur: number; dx: number; dy: number; };
    gradient?: any;         // giữ chỗ cho Phase 7
  };
};

type ImageLayerModel = BaseLayer & {
  type: "image";
  assetId: string;
  crop?: { x:number;y:number;w:number;h:number };
  filters?: { brightness?:number; contrast?:number; blur?:number; saturation?:number };
};


Điểm chốt cực quan trọng

Không lưu state phụ thuộc Fabric (object cache, internal coords).

origin cố định (ví dụ center) để mọi phép biến đổi thống nhất.

Có version/schemaVersion ngay từ đầu để preset không “chết” về sau.

4) Transaction + Undo/Redo (MVP nên có ngay Phase 4–5)
Command pattern tối giản

AddLayerCommand

DeleteLayerCommand

ReorderLayerCommand

UpdateLayerTransformCommand

UpdateTextStyleCommand

UpdateImageFilterCommand

Store

past[], present, future[]

Mỗi command có do() và undo() (hoặc patch ngược)

Lợi ích

Undo/redo tự nhiên

Dùng lại y hệt cho preset import/apply (“apply preset” = 1 command)

5) RenderLoop / Timeline (để animations + export dùng chung)
Timebase

audioTime (từ AudioContext.currentTime) là nguồn đồng hồ chuẩn

projectTime = audioTime + offset (để pause/seek dễ)

Mỗi frame (Editor)

lấy time, features

build RenderGraph từ ProjectConfig

render theo thứ tự:

WebGL background (butterchurn/three/pixi) → render vào framebuffer/canvas

Fabric overlay (text/image) → render lên trên

Nếu đang drag: apply LiveInteractionState (tạm thời) lên render

Quality tiers (giảm giật)

editor: giảm blur/shadow quality, tắt một số effects nặng

preview: gần giống export

export: full quality + deterministic fps

6) Compositing WebGL + Fabric (để không đau ở Phase 8/12)

Khuyến nghị kiến trúc compositing

1 canvas “final” (hoặc offscreen) là output frame

WebGL render vào “bgCanvas”

Fabric render vào “fgCanvas” (hoặc cùng canvas nhưng dễ rối)

Mỗi frame: finalCtx.drawImage(bgCanvas), rồi drawImage(fgCanvas)

Ưu điểm

Export: chỉ cần capture finalCanvas từng frame

Dễ bật/tắt engine WebGL mà không ảnh hưởng overlay

7) Asset pipeline (Image/Audio) – tránh lỗi đường dẫn & export

Khi import: copy vào project workspace (đặt theo hash) → assets[assetId].uri

Sinh thumbnail riêng cho UI list

Nếu nhận URL: phải “download & localize” để tránh tainted canvas khi export

8) Export pipeline (MVP nên làm sớm để lộ lỗi hệ thống)

Export 5–10s MVP (rất nên chèn sớm)

Run loop “deterministic”:

for frame = 0..N-1: t = start + frame/fps

render frame vào offscreen/finalCanvas

encode (WebM/MP4 tuỳ stack) + mux audio

Font loading: đảm bảo font đã ready trước khi render export

Quan trọng

Export không dùng requestAnimationFrame, mà dùng bước thời gian cố định theo fps.

9) Event & Integration points (nối LayerManagerService / FabricCanvasOverlay)
Fabric adapter layer

LayerAdapter.create(layerModel) -> fabric.Object

LayerAdapter.applyModel(obj, layerModel)

LayerAdapter.readTransform(obj) -> Transform

Event mapping

Fabric events:

selection:created/updated → dispatch(SelectLayersCommand(ids))

object:modified → dispatch(UpdateLayerTransformCommand(id, newTransform))

object:moving → update guides/live state (no commit)

Layer panel reorder → dispatch(ReorderLayerCommand(from,to))

10) “Definition of Done” cho từng phần (để không trôi scope)

Phase 4 Done

Drag/scale/rotate mượt

Commit transform chỉ khi modified

Snap/guides tối thiểu

Undo/redo cho transform

Phase 5 Done

Text editor MVP + font loading ổn

Serialize/deserialize project load lại không lệch

Export MVP Done

1 viz + 1 text + 1 image xuất 5s đúng sync audio/time

Nếu bạn muốn, mình có thể viết tiếp bộ checklist triển khai cụ thể cho Phase 4 (Fabric drag & commit + snap/guides + undo/redo) theo đúng blueprint này, gồm:

danh sách event Fabric cần dùng

cấu trúc store/commands

cách tránh loop sync giữa Fabric ↔ ProjectStore

chiến lược multi-select/lock/visibility
(để bạn triển khai luôn vào code hiện tại).

Dưới đây là bộ checklist triển khai Phase 4 (Drag & Drop trên Fabric canvas) theo đúng blueprint mình đưa, kèm mẫu code TypeScript/React để bạn cắm thẳng vào hệ thống hiện tại (FabricCanvasOverlay + LayerManagerService + ProjectConfig).

1) Mục tiêu Phase 4 (Definition of Done)

✅ Kéo/scale/rotate layer trực tiếp trên canvas
✅ Trong lúc kéo: có guides + snap (grid/center/edge)
✅ Khi thả chuột: commit 1 lần về ProjectConfig (không spam state)
✅ Undo/Redo cho move/scale/rotate
✅ Multi-select cơ bản + lock/visibility không phá thao tác

2) Quy ước cứng để khỏi lệch (chốt trước khi code)

Origin cố định: originX = "center", originY = "center" cho mọi object.

Transform lưu trong config theo logical units: {x,y,scaleX,scaleY,rotation}

Fabric object phải có data.layerId để map ngược về layer.

3) Kiến trúc “không loop sync”: 2 luồng cập nhật
Luồng A: Model → Fabric (render)

Khi ProjectConfig thay đổi: apply model lên Fabric objects

Có cờ chặn event để không phát sinh commit ngược

Luồng B: Fabric interaction → Model (commit)

Khi user thả chuột (object:modified): đọc transform từ Fabric → dispatch command → cập nhật ProjectConfig 1 lần

4) Checklist triển khai theo thứ tự
Step 4.1 — Gắn layerId vào Fabric object + adapter

Bạn cần 1 adapter thống nhất đọc/ghi transform.

// layerAdapter.ts
import { fabric } from "fabric";

export type Transform = {
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number; // degrees
};

export function applyTransform(obj: fabric.Object, t: Transform) {
  obj.set({
    left: t.x,
    top: t.y,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    angle: t.rotation,
    originX: "center",
    originY: "center",
  });
  obj.setCoords();
}

export function readTransform(obj: fabric.Object): Transform {
  return {
    x: obj.left ?? 0,
    y: obj.top ?? 0,
    scaleX: obj.scaleX ?? 1,
    scaleY: obj.scaleY ?? 1,
    rotation: obj.angle ?? 0,
  };
}


Khi tạo object từ layer:

const obj = new fabric.Textbox(layer.text, {...});
obj.data = { layerId: layer.id };
obj.originX = "center"; obj.originY = "center";

Step 4.2 — “Interaction Session”: lưu before/after để Undo/Redo

Trong FabricCanvasOverlay, khi bắt đầu drag/transform, lưu transform ban đầu.

type InteractionSession = {
  layerIds: string[];
  before: Record<string, Transform>;
};

let session: InteractionSession | null = null;


mouse:down (nếu target/select): tạo session + snapshot before

object:modified: snapshot after → dispatch command

Step 4.3 — Command + History stack (MVP cho Phase 4)

Chỉ cần 1 command cho transform.

// commands.ts
export type UpdateLayerTransformPayload = {
  ids: string[];
  before: Record<string, Transform>;
  after: Record<string, Transform>;
};

export interface Command {
  do(): void;
  undo(): void;
}

export class UpdateLayerTransformCommand implements Command {
  constructor(
    private store: { updateTransforms: (map: Record<string, Transform>) => void },
    private payload: UpdateLayerTransformPayload
  ) {}

  do()   { this.store.updateTransforms(this.payload.after); }
  undo() { this.store.updateTransforms(this.payload.before); }
}


History store tối giản:

class History {
  past: Command[] = [];
  future: Command[] = [];

  execute(cmd: Command) {
    cmd.do();
    this.past.push(cmd);
    this.future = [];
  }
  undo() {
    const cmd = this.past.pop(); if (!cmd) return;
    cmd.undo(); this.future.push(cmd);
  }
  redo() {
    const cmd = this.future.pop(); if (!cmd) return;
    cmd.do(); this.past.push(cmd);
  }
}

Step 4.4 — Hook Fabric events đúng cách (commit 1 lần)

Trong FabricCanvasOverlay:

A) Cờ chặn loop

let isApplyingFromModel = false;


B) Setup events

canvas.on("mouse:down", (e) => {
  if (isApplyingFromModel) return;
  const active = canvas.getActiveObject();
  const actives = canvas.getActiveObjects();

  const targets = actives.length ? actives : (active ? [active] : []);
  const ids = targets
    .map(o => o.data?.layerId)
    .filter(Boolean) as string[];

  if (!ids.length) { session = null; return; }

  session = {
    layerIds: ids,
    before: Object.fromEntries(
      targets.map(o => [o.data.layerId, readTransform(o)])
    ),
  };
});

// object:modified bắn sau khi thả (move/scale/rotate)
canvas.on("object:modified", () => {
  if (isApplyingFromModel) return;
  if (!session) return;

  const targets = canvas.getActiveObjects();
  const after: Record<string, Transform> = {};
  for (const o of targets) {
    const id = o.data?.layerId;
    if (!id) continue;
    after[id] = readTransform(o);
  }

  history.execute(new UpdateLayerTransformCommand(store, {
    ids: session.layerIds,
    before: session.before,
    after,
  }));

  session = null;
});


Lưu ý: getActiveObjects() cho multi-select. Nếu chỉ 1 object, Fabric vẫn trả 1 mảng.

Step 4.5 — Apply ProjectConfig → Fabric mà không gây commit ngược

Khi render sync từ ProjectConfig:

function applyModelToCanvas(layers: LayerModel[]) {
  isApplyingFromModel = true;
  try {
    for (const layer of layers) {
      const obj = findObjectByLayerId(layer.id);
      if (!obj) continue;
      applyTransform(obj, layer.transform);
      obj.visible = layer.visible;
      obj.selectable = !layer.locked;
      obj.evented = !layer.locked;
      // opacity...
    }
    canvas.requestRenderAll();
  } finally {
    isApplyingFromModel = false;
  }
}

5) Snap + Guides (MVP đủ “pro” nhưng không quá nặng)
5.1 Snap to grid (dễ nhất)

Chọn gridSize: 10/20 px

Trong object:moving: chỉnh left/top về gần grid

const grid = 10;
canvas.on("object:moving", (e) => {
  const obj = e.target;
  if (!obj || isApplyingFromModel) return;

  const x = obj.left ?? 0;
  const y = obj.top ?? 0;
  obj.set({
    left: Math.round(x / grid) * grid,
    top:  Math.round(y / grid) * grid,
  });
});


Mẹo: cho phép giữ Alt để tắt snap: nếu bạn có keyboard state.

5.2 Snap theo center canvas + guides

Lấy canvasCenterX = width/2, canvasCenterY = height/2

Nếu object gần center trong tolerance (vd 6px) → snap và vẽ guide line

Guide layer: dùng fabric.Line nhưng set selectable=false, evented=false, excludeFromExport=true (hoặc tự remove trước export).

const tolerance = 6;
let guideX: fabric.Line | null = null;
let guideY: fabric.Line | null = null;

function showGuides(cx: number, cy: number) {
  if (!guideX) {
    guideX = new fabric.Line([cx, 0, cx, canvas.getHeight()], {
      selectable: false, evented: false, excludeFromExport: true,
    });
    canvas.add(guideX);
  } else {
    guideX.set({ x1: cx, x2: cx, y1: 0, y2: canvas.getHeight() });
  }

  if (!guideY) {
    guideY = new fabric.Line([0, cy, canvas.getWidth(), cy], {
      selectable: false, evented: false, excludeFromExport: true,
    });
    canvas.add(guideY);
  } else {
    guideY.set({ x1: 0, x2: canvas.getWidth(), y1: cy, y2: cy });
  }
}

function hideGuides() {
  if (guideX) { canvas.remove(guideX); guideX = null; }
  if (guideY) { canvas.remove(guideY); guideY = null; }
}

canvas.on("object:moving", (e) => {
  const obj = e.target;
  if (!obj || isApplyingFromModel) return;

  const cx = canvas.getWidth() / 2;
  const cy = canvas.getHeight() / 2;

  let snapped = false;

  const ox = obj.left ?? 0;
  const oy = obj.top ?? 0;

  if (Math.abs(ox - cx) <= tolerance) { obj.set({ left: cx }); snapped = true; }
  if (Math.abs(oy - cy) <= tolerance) { obj.set({ top: cy }); snapped = true; }

  if (snapped) showGuides(cx, cy);
  else hideGuides();

  obj.setCoords();
  canvas.requestRenderAll();
});

canvas.on("mouse:up", () => hideGuides());


Sau này snap theo edge/center của object khác cũng tương tự: tính bounding rect của các object còn lại, tìm điểm gần nhất.

6) Multi-select + lock/visibility (để không phá UX)
Multi-select

Bật canvas.selection = true

Với layer locked: selectable=false + evented=false để không vào selection.

Visibility toggle

obj.visible = false thì Fabric vẫn có thể “hit-test weird” nếu không setCoords; tốt nhất gọi obj.setCoords() và canvas.requestRenderAll().

7) Z-index / Reorder (liên quan drag trực tiếp)

Bạn đang có LayerTabEnhanced reorder. Khi reorder, phải:

update layers[] trong ProjectConfig

apply order lên Fabric:

remove/add lại theo thứ tự

hoặc dùng canvas.moveTo(obj, index)

MVP: mỗi lần reorder, loop layers và canvas.moveTo(obj, i).

8) “Bẫy” hay gặp (đọc để khỏi mất 2–3 ngày debug)

origin không đồng nhất → scale/rotate xong vị trí lệch khi reload

object:moving commit config liên tục → lag, undo rác

thiếu isApplyingFromModel → loop sync vô tận

guides là Fabric object nhưng quên excludeFromExport → export dính line

ảnh lớn: drag giật → cần objectCaching hợp lý / downscale thumbnail

9) Kết quả sau khi làm xong Phase 4 (bạn sẽ có ngay)

Drag & drop “pro” (snap + guides)

Commit transform chuẩn (mouseup/modified)

Undo/redo cơ bản cho thao tác trên canvas

Nền tảng sạch để qua Phase 5 (Text editor) không bị refactor