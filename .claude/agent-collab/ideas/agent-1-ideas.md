# Agent 1 — Ideas: Nang cap wave styles co ban

## Wave styles phu trach
bars, circlebars, line, ring, dots, waveform

---

## 1. Nang cap `bars` — Thanh
**Hien tai**: 2-pass (glow + sharp), spectrum-mapped, 4 canh.
**Nang cap**:
- Them gradient fill ben trong moi bar (gradient doc tu goc ra ngoai)
- Bar tip glow: diem sang o dau moi bar khi amplitude cao
- Beat pulse: scale bar width 1.15x khi beat > 0.5
- Rounded cap voi highlight dot o tip

## 2. Nang cap `circlebars` — Tia tron
**Hien tai**: 2-pass, radial bars tu vong tron.
**Nang cap**:
- Inner mirror: them layer bars chieu vao trong (nhu audio spectrum pro)
- Them ring glow o base radius khi beat > 0.3
- Gradient per-bar: moi bar co gradient tu transparent -> solid
- Particle sparkle o dau bar khi amplitude > 0.7

## 3. Nang cap `line` — Duong
**Hien tai**: Catmull-Rom spline quanh rect, 2-pass.
**Nang cap**:
- Multi-layer: 3 duong voi do offset khac nhau (depth effect)
- Breathing effect: line width pulsate theo bass
- Trail effect: ve shadow cua frame truoc voi opacity giam dan

## 4. Nang cap `ring` — Vanh
**Hien tai**: Filled band + spline outer.
**Nang cap**:
- Dual ring: them ring thu 2 nho hon ben trong (treble-reactive)
- Pulsing fill: opacity cua filled band animate theo beat
- Rotating glow spots: 4-6 diem sang di chuyen tren ring

## 5. Nang cap `dots` — Cham
**Hien tai**: Dots + constellation lines.
**Nang cap**:
- Pulsating dots: moi dot co animation scale rieng (sin wave offset)
- Connection web: ket noi dots gan nhau bang arc thay vi line thang
- Them outer ring cua micro-dots nho hon

## 6. Nang cap `waveform` — Song am
**Hien tai**: Filled band + spline, giong ring nhung co fill.
**Nang cap**:
- Multi-band fill: 3 lop fill voi frequency bands khac nhau (bass, mid, treble)
- Gradient fill tu trung tam ra ngoai (radial-like)
- Peak markers: cham sang o cac dinh cao nhat

---

## Wave styles MOI

## 7. `diamondgrid` — Luoi kim cuong
**Y tuong**: Grid hinh thoi/diamond patter quanh rect. Moi cell sang len theo spectrum.
- Grid pattern: 6x6 diamond cells moi canh
- Moi cell co brightness map tu spectrum bin tuong ung
- Connection lines giua cells tao pattern dep
- Beat: cells flash khi beat > 0.5
- **Category**: geometric

## 8. `radar` — Radar quet
**Y tuong**: Vong tron radar voi tia quet quay, dots hien thi theo beat.
- Radar sweep: tia quet xanh la quay 360 do
- Concentric rings (3-4 vong tron)
- Blip dots: xuat hien tai vi tri spectrum amplitude cao
- Fading trail phia sau tia quet
- Grid lines nhu radar that
- **Category**: tech
