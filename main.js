import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MAJOR_RADIUS = 20;
const MINOR_RADIUS = 10;
const U_CELLS = 16;
const V_CELLS = 8;
const DU = (Math.PI * 2) / U_CELLS;
const DV = (Math.PI * 2) / V_CELLS;
const CELL_SUBDIV_U = 5;
const CELL_SUBDIV_V = 5;
const DRAG_DEADZONE_PX = 8;
const MIN_STEP_PROJECTION_PX = 4;
const TRACKPAD_ORBIT_SENSITIVITY = 0.0026;
const TOUCH_ORBIT_SENSITIVITY = 0.01;
const SCRAMBLE_MOVE_COUNT = 100;
const VIEW_OFFSET_Y_PX = 28;
const BASE_FOV = 45;
const MOBILE_MAX_DIM_PX = 1024;
const MOBILE_PORTRAIT_DISTANCE_NEAR = 118;
const MOBILE_PORTRAIT_DISTANCE_FAR = 150;
const MOBILE_LANDSCAPE_DISTANCE_NEAR = 96;
const MOBILE_LANDSCAPE_DISTANCE_FAR = 66;
const MOBILE_PORTRAIT_ASPECT_RANGE = 0.55;
const MOBILE_LANDSCAPE_ASPECT_RANGE = 1.4;
const MOBILE_MIN_DISTANCE = 46;
const MOBILE_MAX_DISTANCE = 160;
const MOBILE_VIEW_OFFSET_Y_PX = 10;
const BOUNDARY_ARC_SEGMENTS = 18;
const BOUNDARY_ARC_LIFT = 0.02;
const BOUNDARY_ARC_COLOR = 0x000000;
const SELECT_OUTLINE_SEGMENTS = 48;
const SELECT_OUTLINE_LIFT = 0.14;
const SELECT_OUTLINE_COLOR = 0xffffff;

const PALETTE = [
  0xd43729,
  0x2e84d8,
  0x2a9d55,
  0xef9b20,
  0x7d4ac7,
  0x139f9f,
  0xd64a8e,
  0xd6bf1f,
];

const canvas = document.querySelector("#game-canvas");
const stageWrap = document.querySelector(".stage-wrap");
const statusText = document.querySelector("#status-text");
const scrambleBtn = document.querySelector("#scramble-btn");
const resetBtn = document.querySelector("#reset-btn");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xebe5d2, 1);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 500);
camera.up.set(0, 0, 1);
camera.position.set(56, 38, 28);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.enableZoom = false;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.minDistance = 35;
controls.maxDistance = 140;
controls.update();
const BASE_CAMERA_DISTANCE = camera.position.distanceTo(controls.target);

const hemiLight = new THREE.HemisphereLight(0xfff6db, 0x7f8ca5, 0.85);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
keyLight.position.set(48, 16, 62);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xb9d6ff, 0.35);
fillLight.position.set(-42, -48, 22);
scene.add(fillLight);

const torusGroup = new THREE.Group();
scene.add(torusGroup);
const boundaryArcGroup = new THREE.Group();
const selectedOutlineGroup = new THREE.Group();
const selectedOutlineLines = [];
torusGroup.add(boundaryArcGroup);

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

const stickers = [];
const stickerById = new Map();
const stickerMeshes = [];
const board = Array.from({ length: U_CELLS }, () => Array(V_CELLS).fill(null));
const initialColorByCell = Array.from({ length: U_CELLS }, () => Array(V_CELLS).fill(0));

let nextStickerId = 1;
let selectedStickerId = null;
const interactionState = {
  mode: "idle",
  activePointers: new Map(),
  ringDrag: null,
  ignoreNextClick: false,
  orbitPrevCentroid: null,
  orbitLastInputMs: 0,
  mouseOrbitActive: false,
};

init();

function init() {
  buildBoard();
  buildSelectedOutline();
  resizeRenderer();
  installHandlers();
  refreshStatusText();
  window.addEventListener("resize", () => {
    resizeRenderer();
    refreshStatusText();
  });
  requestAnimationFrame(frame);
}

function buildBoard() {
  for (let iu = 0; iu < U_CELLS; iu += 1) {
    for (let iv = 0; iv < V_CELLS; iv += 1) {
      const colorIndex = octantColorIndexForCell(iu, iv);
      initialColorByCell[iu][iv] = colorIndex;

      const geometry = makeCellGeometry();
      const material = new THREE.MeshStandardMaterial({
        color: PALETTE[colorIndex],
        roughness: 0.46,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      const id = `sticker-${nextStickerId}`;
      nextStickerId += 1;
      mesh.userData.stickerId = id;

      const sticker = {
        id,
        iu,
        iv,
        initialIu: iu,
        initialIv: iv,
        colorIndex,
        mesh,
        geometry,
        positions: geometry.attributes.position.array,
        normals: geometry.attributes.normal.array,
        boundaryArcs: createStickerBoundaryArcs(),
      };

      setStickerParametricPosition(sticker, 0, 0);
      stickers.push(sticker);
      stickerById.set(id, sticker);
      stickerMeshes.push(mesh);
      board[iu][iv] = sticker;
      torusGroup.add(mesh);
    }
  }
}

function makeCellGeometry() {
  const vertsAcrossU = CELL_SUBDIV_U + 1;
  const vertsAcrossV = CELL_SUBDIV_V + 1;
  const vertexCount = vertsAcrossU * vertsAcrossV;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  const indices = [];
  for (let j = 0; j < CELL_SUBDIV_V; j += 1) {
    for (let i = 0; i < CELL_SUBDIV_U; i += 1) {
      const a = j * vertsAcrossU + i;
      const b = a + 1;
      const d = (j + 1) * vertsAcrossU + i;
      const c = d + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function setStickerParametricPosition(sticker, uOffsetCells, vOffsetCells) {
  const positions = sticker.positions;
  const normals = sticker.normals;

  let cursor = 0;
  for (let j = 0; j <= CELL_SUBDIV_V; j += 1) {
    const v = (sticker.iv + vOffsetCells + j / CELL_SUBDIV_V) * DV;
    const cosV = Math.cos(v);
    const sinV = Math.sin(v);

    for (let i = 0; i <= CELL_SUBDIV_U; i += 1) {
      const u = (sticker.iu + uOffsetCells + i / CELL_SUBDIV_U) * DU;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);

      const radial = MAJOR_RADIUS + MINOR_RADIUS * cosV;
      positions[cursor] = radial * cosU;
      positions[cursor + 1] = radial * sinU;
      positions[cursor + 2] = MINOR_RADIUS * sinV;

      normals[cursor] = cosU * cosV;
      normals[cursor + 1] = sinU * cosV;
      normals[cursor + 2] = sinV;

      cursor += 3;
    }
  }

  sticker.geometry.attributes.position.needsUpdate = true;
  sticker.geometry.attributes.normal.needsUpdate = true;
  sticker.geometry.computeBoundingSphere();
  updateStickerBoundaryArcs(sticker, uOffsetCells, vOffsetCells);
}

function torusPoint(u, v) {
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosV = Math.cos(v);
  const sinV = Math.sin(v);

  const radial = MAJOR_RADIUS + MINOR_RADIUS * cosV;
  return {
    x: radial * cosU,
    y: radial * sinU,
    z: MINOR_RADIUS * sinV,
  };
}

function writeTorusPointLifted(positions, offset, u, v, lift) {
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosV = Math.cos(v);
  const sinV = Math.sin(v);

  const radial = MAJOR_RADIUS + MINOR_RADIUS * cosV;
  const normalX = cosU * cosV;
  const normalY = sinU * cosV;
  const normalZ = sinV;

  positions[offset] = radial * cosU + normalX * lift;
  positions[offset + 1] = radial * sinU + normalY * lift;
  positions[offset + 2] = MINOR_RADIUS * sinV + normalZ * lift;
}

function createBoundaryArcLine() {
  const positions = new Float32Array((BOUNDARY_ARC_SEGMENTS + 1) * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: BOUNDARY_ARC_COLOR,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const line = new THREE.Line(geometry, material);
  line.renderOrder = 2;
  line.frustumCulled = false;
  boundaryArcGroup.add(line);
  return { geometry, positions };
}

function createStickerBoundaryArcs() {
  return [
    createBoundaryArcLine(),
    createBoundaryArcLine(),
    createBoundaryArcLine(),
    createBoundaryArcLine(),
  ];
}

function updateStickerArcEdge(lineData, uStart, vStart, uEnd, vEnd) {
  let offset = 0;
  for (let step = 0; step <= BOUNDARY_ARC_SEGMENTS; step += 1) {
    const t = step / BOUNDARY_ARC_SEGMENTS;
    const u = THREE.MathUtils.lerp(uStart, uEnd, t);
    const v = THREE.MathUtils.lerp(vStart, vEnd, t);
    writeTorusPointLifted(lineData.positions, offset, u, v, BOUNDARY_ARC_LIFT);
    offset += 3;
  }

  lineData.geometry.attributes.position.needsUpdate = true;
  lineData.geometry.computeBoundingSphere();
}

function updateStickerBoundaryArcs(sticker, uOffsetCells, vOffsetCells) {
  if (!sticker.boundaryArcs) {
    return;
  }

  const uMin = (sticker.iu + uOffsetCells) * DU;
  const uMax = (sticker.iu + uOffsetCells + 1) * DU;
  const vMin = (sticker.iv + vOffsetCells) * DV;
  const vMax = (sticker.iv + vOffsetCells + 1) * DV;

  updateStickerArcEdge(sticker.boundaryArcs[0], uMin, vMin, uMax, vMin);
  updateStickerArcEdge(sticker.boundaryArcs[1], uMax, vMin, uMax, vMax);
  updateStickerArcEdge(sticker.boundaryArcs[2], uMax, vMax, uMin, vMax);
  updateStickerArcEdge(sticker.boundaryArcs[3], uMin, vMax, uMin, vMin);
}

function createSelectedOutlineLine() {
  const positions = new Float32Array((SELECT_OUTLINE_SEGMENTS + 1) * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: SELECT_OUTLINE_COLOR,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const line = new THREE.Line(geometry, material);
  line.renderOrder = 3;
  line.frustumCulled = false;
  selectedOutlineGroup.add(line);
  return { geometry, positions };
}

function buildSelectedOutline() {
  for (let index = 0; index < 4; index += 1) {
    selectedOutlineLines.push(createSelectedOutlineLine());
  }
  selectedOutlineGroup.visible = false;
  torusGroup.add(selectedOutlineGroup);
}

function getStickerInteractionOffset(sticker) {
  const ringDrag = interactionState.ringDrag;
  if (!ringDrag || !ringDrag.axis) {
    return { u: 0, v: 0 };
  }

  if (ringDrag.axis === "meridional" && sticker.iu === ringDrag.ringIndex) {
    return { u: 0, v: ringDrag.offsetCells };
  }

  if (ringDrag.axis === "longitudinal" && sticker.iv === ringDrag.ringIndex) {
    return { u: ringDrag.offsetCells, v: 0 };
  }

  return { u: 0, v: 0 };
}

function updateOutlineEdge(lineData, uStart, vStart, uEnd, vEnd) {
  let offset = 0;
  for (let step = 0; step <= SELECT_OUTLINE_SEGMENTS; step += 1) {
    const t = step / SELECT_OUTLINE_SEGMENTS;
    const u = THREE.MathUtils.lerp(uStart, uEnd, t);
    const v = THREE.MathUtils.lerp(vStart, vEnd, t);
    writeTorusPointLifted(lineData.positions, offset, u, v, SELECT_OUTLINE_LIFT);
    offset += 3;
  }

  lineData.geometry.attributes.position.needsUpdate = true;
  lineData.geometry.computeBoundingSphere();
}

function updateSelectedOutline() {
  if (!selectedStickerId) {
    selectedOutlineGroup.visible = false;
    return;
  }

  const selected = stickerById.get(selectedStickerId);
  if (!selected) {
    selectedOutlineGroup.visible = false;
    return;
  }

  const movementOffset = getStickerInteractionOffset(selected);
  const uMin = (selected.iu + movementOffset.u) * DU;
  const uMax = (selected.iu + movementOffset.u + 1) * DU;
  const vMin = (selected.iv + movementOffset.v) * DV;
  const vMax = (selected.iv + movementOffset.v + 1) * DV;

  updateOutlineEdge(selectedOutlineLines[0], uMin, vMin, uMax, vMin);
  updateOutlineEdge(selectedOutlineLines[1], uMax, vMin, uMax, vMax);
  updateOutlineEdge(selectedOutlineLines[2], uMax, vMax, uMin, vMax);
  updateOutlineEdge(selectedOutlineLines[3], uMin, vMax, uMin, vMin);

  selectedOutlineGroup.visible = true;
}

function octantColorIndexForCell(iu, iv) {
  const uCenter = (iu + 0.5) * DU;
  const vCenter = (iv + 0.5) * DV;
  const p = torusPoint(uCenter, vCenter);

  const bitX = p.x >= 0 ? 1 : 0;
  const bitY = p.y >= 0 ? 1 : 0;
  const bitZ = p.z >= 0 ? 1 : 0;

  return (bitX << 2) | (bitY << 1) | bitZ;
}

function pickStickerAtClient(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObjects(stickerMeshes, false)[0];
  if (!hit) {
    return null;
  }

  const stickerId = hit.object.userData.stickerId;
  return stickerById.get(stickerId) || null;
}

function setSelectedStickerExplicit(stickerId) {
  selectedStickerId = stickerId;
  refreshHighlights();
  refreshStatusText();
}

function toggleSelectedSticker(stickerId) {
  if (selectedStickerId === stickerId) {
    setSelectedStickerExplicit(null);
  } else {
    setSelectedStickerExplicit(stickerId);
  }
}

function refreshHighlights() {
  updateSelectedOutline();
}

function rebuildBoardMapping() {
  for (let iu = 0; iu < U_CELLS; iu += 1) {
    board[iu].fill(null);
  }

  for (const sticker of stickers) {
    board[sticker.iu][sticker.iv] = sticker;
  }
}

function getRingStickers(axis, ringIndex) {
  if (axis === "meridional") {
    return stickers.filter((sticker) => sticker.iu === ringIndex);
  }
  return stickers.filter((sticker) => sticker.iv === ringIndex);
}

function projectTorusPointToScreen(point) {
  const rect = renderer.domElement.getBoundingClientRect();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * rect.width,
    y: (-projected.y * 0.5 + 0.5) * rect.height,
  };
}

function getProjectedStepVectorForSticker(sticker, axis, offsetCells) {
  const uOffset = axis === "longitudinal" ? offsetCells : 0;
  const vOffset = axis === "meridional" ? offsetCells : 0;
  const uCenter = (sticker.iu + 0.5 + uOffset) * DU;
  const vCenter = (sticker.iv + 0.5 + vOffset) * DV;
  const p0 = torusPoint(uCenter, vCenter);
  const p1 = axis === "longitudinal" ? torusPoint(uCenter + DU, vCenter) : torusPoint(uCenter, vCenter + DV);
  const s0 = projectTorusPointToScreen(p0);
  const s1 = projectTorusPointToScreen(p1);
  return {
    x: s1.x - s0.x,
    y: s1.y - s0.y,
  };
}

function chooseDragAxisForRingDrag(sticker, dragX, dragY) {
  const longVec = getProjectedStepVectorForSticker(sticker, "longitudinal", 0);
  const merVec = getProjectedStepVectorForSticker(sticker, "meridional", 0);
  const longLen = Math.hypot(longVec.x, longVec.y);
  const merLen = Math.hypot(merVec.x, merVec.y);
  const dragLen = Math.hypot(dragX, dragY);

  if (dragLen < 0.0001) {
    return null;
  }

  if (longLen < MIN_STEP_PROJECTION_PX && merLen < MIN_STEP_PROJECTION_PX) {
    return Math.abs(dragX) >= Math.abs(dragY) ? "longitudinal" : "meridional";
  }

  const dragUnitX = dragX / dragLen;
  const dragUnitY = dragY / dragLen;
  const longScore =
    longLen >= MIN_STEP_PROJECTION_PX ? Math.abs((dragUnitX * longVec.x + dragUnitY * longVec.y) / longLen) : -1;
  const merScore =
    merLen >= MIN_STEP_PROJECTION_PX ? Math.abs((dragUnitX * merVec.x + dragUnitY * merVec.y) / merLen) : -1;

  return longScore >= merScore ? "longitudinal" : "meridional";
}

function setRingDragVisualOffset(ringDrag) {
  if (!ringDrag.axis || !ringDrag.movingStickers) {
    return;
  }

  const uOffset = ringDrag.axis === "longitudinal" ? ringDrag.offsetCells : 0;
  const vOffset = ringDrag.axis === "meridional" ? ringDrag.offsetCells : 0;
  for (const sticker of ringDrag.movingStickers) {
    setStickerParametricPosition(sticker, uOffset, vOffset);
  }
}

function clearRingDragVisual(ringDrag) {
  if (!ringDrag || !ringDrag.movingStickers) {
    return;
  }
  for (const sticker of ringDrag.movingStickers) {
    setStickerParametricPosition(sticker, 0, 0);
  }
}

function applyRingSteps(axis, ringIndex, steps) {
  if (!steps) {
    return;
  }

  const movingStickers = getRingStickers(axis, ringIndex);
  if (axis === "meridional") {
    for (const sticker of movingStickers) {
      sticker.iv = modulo(sticker.iv + steps, V_CELLS);
      setStickerParametricPosition(sticker, 0, 0);
    }
    return;
  }

  for (const sticker of movingStickers) {
    sticker.iu = modulo(sticker.iu + steps, U_CELLS);
    setStickerParametricPosition(sticker, 0, 0);
  }
}

function applyDiscreteMoveForAnchor(type, dir, anchorStickerId) {
  const anchorSticker = stickerById.get(anchorStickerId);
  if (!anchorSticker) {
    return;
  }

  const ringIndex = type === "meridional" ? anchorSticker.iu : anchorSticker.iv;
  applyRingSteps(type, ringIndex, dir);
  rebuildBoardMapping();
  refreshHighlights();
  refreshStatusText();
}

function orbitCameraByPixels(deltaX, deltaY, sensitivity) {
  const wasEnabled = controls.enabled;
  if (!wasEnabled) {
    controls.enabled = true;
  }
  controls.rotateLeft(deltaX * sensitivity);
  controls.rotateUp(deltaY * sensitivity);
  controls.update();
  controls.enabled = wasEnabled;
}

function getTouchCentroid() {
  const points = Array.from(interactionState.activePointers.values());
  if (points.length < 2) {
    return null;
  }
  return {
    x: (points[0].x + points[1].x) * 0.5,
    y: (points[0].y + points[1].y) * 0.5,
  };
}

function updateInteractionMode() {
  if (interactionState.ringDrag) {
    interactionState.mode = "ring_drag";
    return;
  }

  const orbitRecent = performance.now() - interactionState.orbitLastInputMs < 120;
  if (interactionState.mouseOrbitActive || interactionState.activePointers.size >= 2 || orbitRecent) {
    interactionState.mode = "orbit";
    return;
  }

  interactionState.mode = "idle";
}

function startRingDrag(pointerId, pointerType, clientX, clientY, sticker) {
  if (!sticker) {
    return;
  }

  interactionState.ignoreNextClick = true;
  const wasSelectedOnDown = selectedStickerId === sticker.id;
  setSelectedStickerExplicit(sticker.id);

  interactionState.ringDrag = {
    pointerId,
    pointerType,
    anchorStickerId: sticker.id,
    wasSelectedOnDown,
    startX: clientX,
    startY: clientY,
    lastX: clientX,
    lastY: clientY,
    axis: null,
    ringIndex: null,
    movingStickers: null,
    offsetCells: 0,
    lastStepUnitX: 0,
    lastStepUnitY: 0,
    lastStepLen: 0,
  };
  updateInteractionMode();
}

function cancelRingDrag(revertVisuals) {
  const ringDrag = interactionState.ringDrag;
  if (!ringDrag) {
    return;
  }
  if (revertVisuals) {
    clearRingDragVisual(ringDrag);
  }
  interactionState.ringDrag = null;
  updateInteractionMode();
}

function finishRingDrag(clientX, clientY) {
  const ringDrag = interactionState.ringDrag;
  if (!ringDrag) {
    return;
  }

  const totalMove = Math.hypot(clientX - ringDrag.startX, clientY - ringDrag.startY);
  if (!ringDrag.axis || totalMove < DRAG_DEADZONE_PX) {
    clearRingDragVisual(ringDrag);
    interactionState.ringDrag = null;
    if (ringDrag.wasSelectedOnDown) {
      setSelectedStickerExplicit(null);
    } else {
      setSelectedStickerExplicit(ringDrag.anchorStickerId);
    }
    updateInteractionMode();
    return;
  }

  const snapSteps = Math.round(ringDrag.offsetCells);
  if (snapSteps === 0) {
    clearRingDragVisual(ringDrag);
  } else {
    applyRingSteps(ringDrag.axis, ringDrag.ringIndex, snapSteps);
    rebuildBoardMapping();
  }

  interactionState.ringDrag = null;
  updateInteractionMode();
  refreshHighlights();
  refreshStatusText();
}

function updateRingDragFromPointer(clientX, clientY) {
  const ringDrag = interactionState.ringDrag;
  if (!ringDrag) {
    return;
  }

  const dx = clientX - ringDrag.lastX;
  const dy = clientY - ringDrag.lastY;
  const totalDx = clientX - ringDrag.startX;
  const totalDy = clientY - ringDrag.startY;
  ringDrag.lastX = clientX;
  ringDrag.lastY = clientY;

  const anchorSticker = stickerById.get(ringDrag.anchorStickerId);
  if (!anchorSticker) {
    cancelRingDrag(true);
    return;
  }

  if (!ringDrag.axis) {
    if (Math.hypot(totalDx, totalDy) < DRAG_DEADZONE_PX) {
      return;
    }
    ringDrag.axis = chooseDragAxisForRingDrag(anchorSticker, totalDx, totalDy);
    if (!ringDrag.axis) {
      return;
    }
    ringDrag.ringIndex = ringDrag.axis === "meridional" ? anchorSticker.iu : anchorSticker.iv;
    ringDrag.movingStickers = getRingStickers(ringDrag.axis, ringDrag.ringIndex);
    refreshStatusText();
  }

  const stepVector = getProjectedStepVectorForSticker(anchorSticker, ringDrag.axis, ringDrag.offsetCells);
  const stepLen = Math.hypot(stepVector.x, stepVector.y);

  if (stepLen >= MIN_STEP_PROJECTION_PX) {
    ringDrag.lastStepUnitX = stepVector.x / stepLen;
    ringDrag.lastStepUnitY = stepVector.y / stepLen;
    ringDrag.lastStepLen = stepLen;
  }

  if (ringDrag.lastStepLen < MIN_STEP_PROJECTION_PX) {
    return;
  }

  const projectedDeltaPx = dx * ringDrag.lastStepUnitX + dy * ringDrag.lastStepUnitY;
  ringDrag.offsetCells += projectedDeltaPx / ringDrag.lastStepLen;
  setRingDragVisualOffset(ringDrag);
}

function installHandlers() {
  renderer.domElement.addEventListener("click", onCanvasClick);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  renderer.domElement.addEventListener("wheel", onCanvasWheel, { passive: false });
  renderer.domElement.addEventListener("pointerdown", onCanvasPointerDown);
  renderer.domElement.addEventListener("pointermove", onCanvasPointerMove);
  renderer.domElement.addEventListener("pointerup", onCanvasPointerUpOrCancel);
  renderer.domElement.addEventListener("pointercancel", onCanvasPointerUpOrCancel);

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
      return;
    }
    if (!selectedStickerId) {
      return;
    }

    event.preventDefault();
    if (key === "ArrowUp") {
      applyDiscreteMoveForAnchor("meridional", 1, selectedStickerId);
    } else if (key === "ArrowDown") {
      applyDiscreteMoveForAnchor("meridional", -1, selectedStickerId);
    } else if (key === "ArrowRight") {
      applyDiscreteMoveForAnchor("longitudinal", 1, selectedStickerId);
    } else if (key === "ArrowLeft") {
      applyDiscreteMoveForAnchor("longitudinal", -1, selectedStickerId);
    }
  });

  resetBtn.addEventListener("click", () => {
    resetPuzzle();
  });

  scrambleBtn.addEventListener("click", () => {
    scramblePuzzle();
  });
}

function onCanvasClick(event) {
  if (interactionState.ignoreNextClick) {
    interactionState.ignoreNextClick = false;
    return;
  }

  const sticker = pickStickerAtClient(event.clientX, event.clientY);
  if (!sticker) {
    return;
  }
  toggleSelectedSticker(sticker.id);
}

function onCanvasPointerDown(event) {
  if (event.pointerType === "mouse") {
    if (event.button === 2) {
      interactionState.mouseOrbitActive = true;
      interactionState.orbitLastInputMs = performance.now();
      updateInteractionMode();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const sticker = pickStickerAtClient(event.clientX, event.clientY);
    if (!sticker) {
      return;
    }

    event.preventDefault();
    if (renderer.domElement.setPointerCapture) {
      renderer.domElement.setPointerCapture(event.pointerId);
    }
    startRingDrag(event.pointerId, "mouse", event.clientX, event.clientY, sticker);
    return;
  }

  if (event.pointerType !== "touch") {
    return;
  }

  event.preventDefault();
  interactionState.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  controls.enabled = false;

  if (interactionState.activePointers.size >= 2) {
    cancelRingDrag(true);
    interactionState.orbitPrevCentroid = getTouchCentroid();
    interactionState.orbitLastInputMs = performance.now();
    updateInteractionMode();
    return;
  }

  const sticker = pickStickerAtClient(event.clientX, event.clientY);
  if (sticker) {
    startRingDrag(event.pointerId, "touch", event.clientX, event.clientY, sticker);
  } else {
    updateInteractionMode();
  }
}

function onCanvasPointerMove(event) {
  if (event.pointerType === "touch") {
    if (!interactionState.activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    interactionState.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (interactionState.activePointers.size >= 2) {
      cancelRingDrag(true);
      const centroid = getTouchCentroid();
      if (centroid && interactionState.orbitPrevCentroid) {
        orbitCameraByPixels(
          centroid.x - interactionState.orbitPrevCentroid.x,
          centroid.y - interactionState.orbitPrevCentroid.y,
          TOUCH_ORBIT_SENSITIVITY
        );
      }
      interactionState.orbitPrevCentroid = centroid;
      interactionState.orbitLastInputMs = performance.now();
      updateInteractionMode();
      return;
    }

    if (interactionState.ringDrag && interactionState.ringDrag.pointerId === event.pointerId) {
      updateRingDragFromPointer(event.clientX, event.clientY);
    }
    return;
  }

  if (event.pointerType === "mouse" && interactionState.ringDrag && interactionState.ringDrag.pointerId === event.pointerId) {
    if ((event.buttons & 1) === 0) {
      finishRingDrag(event.clientX, event.clientY);
      return;
    }

    event.preventDefault();
    updateRingDragFromPointer(event.clientX, event.clientY);
  }
}

function onCanvasPointerUpOrCancel(event) {
  if (event.pointerType === "mouse") {
    if (event.button === 2) {
      interactionState.mouseOrbitActive = false;
      updateInteractionMode();
      return;
    }

    if (event.button === 0 && interactionState.ringDrag && interactionState.ringDrag.pointerId === event.pointerId) {
      finishRingDrag(event.clientX, event.clientY);
    }
    return;
  }

  if (event.pointerType !== "touch") {
    return;
  }

  if (interactionState.ringDrag && interactionState.ringDrag.pointerId === event.pointerId) {
    finishRingDrag(event.clientX, event.clientY);
  }

  interactionState.activePointers.delete(event.pointerId);
  if (interactionState.activePointers.size >= 2) {
    interactionState.orbitPrevCentroid = getTouchCentroid();
    interactionState.orbitLastInputMs = performance.now();
  } else {
    interactionState.orbitPrevCentroid = null;
  }

  if (interactionState.activePointers.size === 0) {
    controls.enabled = true;
  }
  updateInteractionMode();
}

function onCanvasWheel(event) {
  if (interactionState.ringDrag) {
    return;
  }

  event.preventDefault();
  orbitCameraByPixels(event.deltaX, event.deltaY, TRACKPAD_ORBIT_SENSITIVITY);
  interactionState.orbitLastInputMs = performance.now();
  updateInteractionMode();
}

function resetPuzzle() {
  cancelRingDrag(true);
  interactionState.activePointers.clear();
  interactionState.mouseOrbitActive = false;
  interactionState.orbitPrevCentroid = null;
  interactionState.ignoreNextClick = false;
  controls.enabled = true;
  updateInteractionMode();

  for (const sticker of stickers) {
    sticker.iu = sticker.initialIu;
    sticker.iv = sticker.initialIv;

    const colorIndex = initialColorByCell[sticker.initialIu][sticker.initialIv];
    sticker.colorIndex = colorIndex;
    sticker.mesh.material.color.setHex(PALETTE[colorIndex]);

    setStickerParametricPosition(sticker, 0, 0);
  }

  selectedStickerId = null;
  rebuildBoardMapping();
  refreshHighlights();
  refreshStatusText();
}

function scramblePuzzle() {
  cancelRingDrag(true);
  interactionState.activePointers.clear();
  interactionState.mouseOrbitActive = false;
  interactionState.orbitPrevCentroid = null;
  controls.enabled = true;
  updateInteractionMode();

  const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

  for (let step = 0; step < SCRAMBLE_MOVE_COUNT; step += 1) {
    const randomIu = Math.floor(Math.random() * U_CELLS);
    const randomIv = Math.floor(Math.random() * V_CELLS);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    const regionSticker = board[randomIu][randomIv];
    if (!regionSticker) {
      continue;
    }

    if (randomKey === "ArrowUp") {
      applyRingSteps("meridional", regionSticker.iu, 1);
    } else if (randomKey === "ArrowDown") {
      applyRingSteps("meridional", regionSticker.iu, -1);
    } else if (randomKey === "ArrowRight") {
      applyRingSteps("longitudinal", regionSticker.iv, 1);
    } else {
      applyRingSteps("longitudinal", regionSticker.iv, -1);
    }

    rebuildBoardMapping();
  }

  refreshHighlights();
  refreshStatusText();
}

function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function resizeRenderer() {
  const width = stageWrap.clientWidth;
  const height = stageWrap.clientHeight;
  renderer.setSize(width, height, false);
  camera.fov = BASE_FOV;
  camera.aspect = width / Math.max(1, height);
  applyResponsiveCameraDistance(width, height);
  const maxDim = Math.max(width, height);
  const viewOffsetY = maxDim <= MOBILE_MAX_DIM_PX ? MOBILE_VIEW_OFFSET_Y_PX : VIEW_OFFSET_Y_PX;
  camera.setViewOffset(width, height, 0, viewOffsetY, width, height);
  camera.updateProjectionMatrix();
  controls.update();
}

function applyResponsiveCameraDistance(width, height) {
  const viewDirection = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (viewDirection.lengthSq() < 1e-8) {
    viewDirection.set(1, 0, 0);
  }
  viewDirection.normalize();

  let distance = BASE_CAMERA_DISTANCE;
  const maxDim = Math.max(width, height);
  if (maxDim <= MOBILE_MAX_DIM_PX) {
    const aspect = width / Math.max(1, height);
    if (aspect <= 1) {
      const t = THREE.MathUtils.clamp((1 - aspect) / MOBILE_PORTRAIT_ASPECT_RANGE, 0, 1);
      distance = THREE.MathUtils.lerp(MOBILE_PORTRAIT_DISTANCE_NEAR, MOBILE_PORTRAIT_DISTANCE_FAR, t);
    } else {
      const t = THREE.MathUtils.clamp((aspect - 1) / MOBILE_LANDSCAPE_ASPECT_RANGE, 0, 1);
      distance = THREE.MathUtils.lerp(MOBILE_LANDSCAPE_DISTANCE_NEAR, MOBILE_LANDSCAPE_DISTANCE_FAR, t);
    }
    distance = THREE.MathUtils.clamp(distance, MOBILE_MIN_DISTANCE, MOBILE_MAX_DISTANCE);
  }

  camera.position.copy(controls.target).addScaledVector(viewDirection, distance);
}

function refreshStatusText() {
  if (!statusText) {
    return;
  }

  const isCoarseTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  if (isCoarseTouch && isLandscape) {
    statusText.textContent = "";
    return;
  }

  const idleInstructions = isCoarseTouch
    ? "Mobile: tap a region to select, drag one finger on a region to move its ring, use two fingers to orbit."
    : "Desktop: click a region to select, left-drag on a region to move its ring, right-drag or two-finger trackpad swipe to orbit. Arrow keys still work.";

  if (!selectedStickerId) {
    statusText.textContent = idleInstructions;
    return;
  }

  const selected = stickerById.get(selectedStickerId);
  if (!selected) {
    statusText.textContent = idleInstructions;
    return;
  }

  const selectedInstructions = isCoarseTouch
    ? "Drag one finger on the selected region to move its ring. Use two fingers to orbit."
    : "Left-drag on the selected region to move its ring; release snaps to the nearest step. Right-drag or two-finger trackpad swipe orbits. Arrow keys still work.";
  statusText.textContent = `Selected region (u=${selected.iu}, v=${selected.iv}). ${selectedInstructions}`;
}

function frame(nowMs) {
  void nowMs;
  updateInteractionMode();
  updateSelectedOutline();
  controls.update();
  renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

function renderGameToText() {
  const selected = selectedStickerId ? stickerById.get(selectedStickerId) : null;
  const boardDump = [];

  for (let iu = 0; iu < U_CELLS; iu += 1) {
    for (let iv = 0; iv < V_CELLS; iv += 1) {
      const sticker = board[iu][iv];
      boardDump.push({
        iu,
        iv,
        stickerId: sticker ? sticker.id : null,
        colorIndex: sticker ? sticker.colorIndex : null,
      });
    }
  }

  const pointerCount = Math.max(
    interactionState.activePointers.size,
    interactionState.ringDrag && interactionState.ringDrag.pointerType === "mouse" ? 1 : 0,
    interactionState.mouseOrbitActive ? 1 : 0
  );

  const ringDrag = interactionState.ringDrag
    ? {
        anchorStickerId: interactionState.ringDrag.anchorStickerId,
        axis: interactionState.ringDrag.axis,
        offsetCells: Number(interactionState.ringDrag.offsetCells.toFixed(4)),
      }
    : null;

  return JSON.stringify({
    mode: interactionState.mode,
    geometry: {
      majorRadius: MAJOR_RADIUS,
      minorRadius: MINOR_RADIUS,
      uCells: U_CELLS,
      vCells: V_CELLS,
      du: DU,
      dv: DV,
    },
    coordinateSystem: "Origin at torus center; +x and +y define the major circle plane; +z is perpendicular to that plane.",
    selected: selected
      ? {
          id: selected.id,
          iu: selected.iu,
          iv: selected.iv,
        }
      : null,
    input: {
      mode: interactionState.mode,
      pointerCount,
      ringDrag,
    },
    board: boardDump,
  });
}

function advanceTime(ms) {
  void ms;
  updateInteractionMode();
  updateSelectedOutline();
  controls.update();
  renderer.render(scene, camera);
  return renderGameToText();
}

window.render_game_to_text = renderGameToText;
window.advanceTime = advanceTime;
