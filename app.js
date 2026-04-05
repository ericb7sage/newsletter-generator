/** ------------------------ storage keys ------------------------ **/
const LS_KEYS = {
  presets: "nlgen_presets_v2",
  state: "nlgen_state_v2",
  projectsFs: "nlgen_projects_fs_v1"
};
const LIBRARY_ITEM_NEW_MARKDOWN = "__new_markdown_section__";
const LIBRARY_ITEM_NEW_HTML_FRAGMENT = "__new_html_fragment__";
const ELEMENT_LIBRARY_ITEM_IMAGE = "image";
const ELEMENT_LIBRARY_ITEM_CTA = "cta";
const ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT = "markdown_fragment";
const ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT = "html_fragment";
const PREVIEW_FONT_STYLESHEET_HREF = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Lexend:wght@400;500;600;700;800&display=swap";
const PROJECT_STORAGE_VERSION = 1;
const PROJECT_DEFAULT_NAME = "Project 1";
const PROJECT_EXPORT_FORMAT_SINGLE = "nlgen-project-v1";
const PROJECT_EXPORT_FORMAT_MULTI = "nlgen-projects-v1";
const PROJECT_FIELD_IDS = Object.freeze([
  "preheader",
  "unsubscribe_url",
  "highlight_label",
  "highlight_title",
  "highlight_url",
  "highlight_avatar",
  "highlight_avatar_alt",
  "highlight_username",
  "highlight_mood",
  "highlight_summary",
  "highlight_button",
  "in_this_newsletter_markdown",
  "feature_header",
  "feature_top_text",
  "feature_img",
  "feature_alt",
  "feature_img_link",
  "feature_img_width",
  "feature_bottom_text",
  "feature_cta_text_1",
  "feature_cta_url_1",
  "feature_cta_text_2",
  "feature_cta_url_2",
  "podcasts_header",
  "blog_desc",
  "discussion_label"
]);

let projectFilesystem = null;
let activeProjectId = "";
let projectFieldDefaults = null;
let applyingProjectSnapshot = false;

function saveState() {
  localStorage.setItem(LS_KEYS.state, JSON.stringify(state));
  syncActiveProjectSnapshot();
}

function savePresets() {
  localStorage.setItem(LS_KEYS.presets, JSON.stringify(presets));
  syncActiveProjectSnapshot();
}

/** ------------------------ defaults (BLANK) ------------------------ **/
const DEFAULT_PRESETS = {
  moods: [
    { id:"motivated", label:"💪 Motivated", bg:"#ebf7fb", text:"#344054" },
    { id:"frustrated", label:"😖 Frustrated", bg:"#f8d4e4", text:"#344054" },
    { id:"happy", label:"😊 Happy", bg:"#f0fdf9", text:"#344054" },
    { id:"none", label:"(None)", bg:"#ffffff", text:"#344054" }
  ],
  topics: [
    { id:"general", label:"General" },
    { id:"lsat", label:"LSAT" },
    { id:"admissions", label:"Admissions" }
  ],
  instructors: [
    { id:"instructor_1", name:"Instructor 1", avatar:"" }
  ],
  difficulties: [
    { id:"basic", label:"Basic", filledCount:1, filled:"#2a6c7f", empty:"#e5eef2" },
    { id:"intermediate", label:"Intermediate", filledCount:2, filled:"#15b79e", empty:"#e5eef2" },
    { id:"advanced", label:"Advanced", filledCount:3, filled:"#227f9c", empty:"#e5eef2" }
  ]
};

function normalizePresets(raw){
  const fallback = deepClone(DEFAULT_PRESETS);
  if (!raw || typeof raw !== "object") return fallback;

  return {
    ...fallback,
    ...raw,
    moods: Array.isArray(raw.moods) && raw.moods.length ? raw.moods : fallback.moods,
    topics: Array.isArray(raw.topics) && raw.topics.length ? raw.topics : fallback.topics,
    instructors: Array.isArray(raw.instructors) && raw.instructors.length ? raw.instructors : fallback.instructors,
    difficulties: Array.isArray(raw.difficulties) && raw.difficulties.length ? raw.difficulties : fallback.difficulties
  };
}

const DEFAULT_STATE = {
  sections: [
    { id:"highlight", label:"Highlight", enabled:true },
    { id:"inThisNewsletter", label:"In This Newsletter", enabled:true },
    { id:"featureSlot", label:"Feature Slot", enabled:false },
    { id:"podcasts", label:"Podcasts", enabled:true },
    { id:"admissionsBlog", label:"Admissions Update", enabled:true },
    { id:"discussion", label:"Discussion Forum Roundup", enabled:true },
    { id:"liveClasses", label:"Free Live Classes", enabled:true },
    { id:"customLinks", label:"Custom Links Section", enabled:true }
  ],
  discussion: [
    { avatar:"", topicId:"general", when:"", username:"", moodId:"none", title:"", url:"" }
  ],
  classes: [
    { time:"", date:"", instructorId:"instructor_1", title:"", url:"", difficultyId:"basic" }
  ],
  customLinks: [
    { prompt:"", linkText:"", url:"" }
  ],
  podcasts: [
    { quote:"", title:"", img:"", alt:"", yt:"", sp:"" }
  ],
  markdownSections: [],
  htmlFragments: [],
  previewEditor: {
    enabled: false,
    activeSectionId: "",
    pendingElementAction: null,
    richOverrides: {}
  }
};

/** ------------------------ state ------------------------ **/
let presets = deepClone(DEFAULT_PRESETS);
let state = loadState();

/** ------------------------ utils ------------------------ **/
function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

// Section IDs that have been removed/replaced and should be silently dropped during migration.
const RETIRED_SECTION_IDS = new Set(["lsatPodcast", "admissionsPodcast", "extraPodcast"]);

function mergeSectionState(savedSections){
  const defaults = deepClone(DEFAULT_STATE.sections);
  const current = Array.isArray(savedSections) ? savedSections : [];
  const defaultsById = new Map(defaults.map((s, idx) => [s.id, { ...s, _defaultIdx: idx }]));
  const seen = new Set();

  // Preserve the user's existing order for known sections.
  const merged = [];
  current.forEach(s => {
    if (!s?.id) return;
    if (RETIRED_SECTION_IDS.has(s.id)) return; // drop legacy sections
    const def = defaultsById.get(s.id);
    if (!def) {
      merged.push(s); // keep unknown/local sections
      return;
    }
    seen.add(s.id);
    // Keep user state (e.g. enabled/order) but use canonical labels from defaults.
    merged.push({ ...def, ...s, label: def.label, _defaultIdx: def._defaultIdx });
  });

  // Insert missing default sections (e.g., newly added Highlight) near their default position.
  defaults.forEach((def, defIdx) => {
    if (seen.has(def.id)) return;
    const insertAt = merged.findIndex(x => Number.isInteger(x?._defaultIdx) && x._defaultIdx > defIdx);
    const next = { ...def, _defaultIdx: defIdx };
    if (insertAt === -1) merged.push(next);
    else merged.splice(insertAt, 0, next);
  });

  return merged.map(({ _defaultIdx, ...rest }) => rest);
}

function isMarkdownSectionId(id){
  return String(id || "").startsWith("markdownSection_");
}

function isHtmlFragmentId(id){
  return String(id || "").startsWith("htmlFragment_");
}

function markdownSectionFallbackLabel(index){
  return `Blank Section ${Number(index) + 1}`;
}

function htmlFragmentFallbackLabel(index){
  return `HTML Fragment ${Number(index) + 1}`;
}

function normalizeMarkdownSections(rawSections){
  if (!Array.isArray(rawSections)) return [];

  const usedIds = new Set();
  return rawSections.map((raw, idx) => {
    const candidateId = String(raw?.id || "").trim();
    let id = isMarkdownSectionId(candidateId) ? candidateId : `markdownSection_${idx + 1}`;
    while (usedIds.has(id)) id = `${id}_${usedIds.size + 1}`;
    usedIds.add(id);

    return {
      id,
      label: String(raw?.label || ""),
      markdown: String(raw?.markdown || ""),
      htmlFragment: String(raw?.htmlFragment || ""),
      ctaText: String(raw?.ctaText || ""),
      ctaUrl: String(raw?.ctaUrl || ""),
      imageUrl: String(raw?.imageUrl || ""),
      imageAlt: String(raw?.imageAlt || ""),
      imageLinkUrl: String(raw?.imageLinkUrl || ""),
      imageWidth: clampNumber(raw?.imageWidth, 220, 560, 520)
    };
  });
}

function normalizeHtmlFragments(rawFragments){
  if (!Array.isArray(rawFragments)) return [];

  const usedIds = new Set();
  return rawFragments.map((raw, idx) => {
    const candidateId = String(raw?.id || "").trim();
    let id = isHtmlFragmentId(candidateId) ? candidateId : `htmlFragment_${idx + 1}`;
    while (usedIds.has(id)) id = `${id}_${usedIds.size + 1}`;
    usedIds.add(id);

    return {
      id,
      label: String(raw?.label || ""),
      html: String(raw?.html || "")
    };
  });
}

function defaultPendingElementValues(elementType) {
  if (elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
    return {
      imageUrl: "",
      imageAlt: "",
      imageLinkUrl: "",
      imageWidth: 520
    };
  }
  if (elementType === ELEMENT_LIBRARY_ITEM_CTA) {
    return {
      ctaText: "Learn more",
      ctaUrl: ""
    };
  }
  if (elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
    return { markdown: "" };
  }
  if (elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
    return { htmlFragment: "" };
  }
  return {};
}

function normalizePendingElementAction(rawAction) {
  if (!rawAction || typeof rawAction !== "object") return null;
  const elementType = String(rawAction.elementType || "");
  if (![
    ELEMENT_LIBRARY_ITEM_IMAGE,
    ELEMENT_LIBRARY_ITEM_CTA,
    ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT,
    ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT
  ].includes(elementType)) return null;

  const values = { ...defaultPendingElementValues(elementType) };
  const rawValues = (rawAction.values && typeof rawAction.values === "object") ? rawAction.values : {};

  if (elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
    values.imageUrl = String(rawValues.imageUrl || "");
    values.imageAlt = String(rawValues.imageAlt || "");
    values.imageLinkUrl = String(rawValues.imageLinkUrl || "");
    values.imageWidth = clampNumber(rawValues.imageWidth, 220, 560, 520);
  } else if (elementType === ELEMENT_LIBRARY_ITEM_CTA) {
    values.ctaText = String(rawValues.ctaText || "");
    values.ctaUrl = String(rawValues.ctaUrl || "");
  } else if (elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
    values.markdown = String(rawValues.markdown || "");
  } else if (elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
    values.htmlFragment = String(rawValues.htmlFragment || "");
  }

  const targetSectionId = String(rawAction.targetSectionId || "");
  const rawTargetIndex = Number(rawAction.targetEnabledIndex);
  const targetEnabledIndex = Number.isFinite(rawTargetIndex) ? Math.max(0, Math.round(rawTargetIndex)) : null;

  return {
    elementType,
    targetSectionId,
    targetEnabledIndex,
    values
  };
}

function syncMarkdownSections(sectionState, markdownSections){
  const sections = Array.isArray(sectionState) ? sectionState : [];
  const markdownById = new Map(markdownSections.map((m, idx) => [m.id, { ...m, _idx: idx }]));
  const seenMarkdown = new Set();
  const out = [];

  sections.forEach(sec => {
    if (!sec?.id || sec.id === "markdownSections" || sec.id === "htmlFragments") return;

    if (isMarkdownSectionId(sec.id)) {
      const md = markdownById.get(sec.id);
      if (!md) return;
      out.push({
        ...sec,
        id: md.id,
        label: String(md.label || "").trim() || markdownSectionFallbackLabel(md._idx),
        enabled: sec.enabled !== false
      });
      seenMarkdown.add(md.id);
      return;
    }

    out.push(sec);
  });

  markdownSections.forEach((md, idx) => {
    if (seenMarkdown.has(md.id)) return;
    out.push({
      id: md.id,
      label: String(md.label || "").trim() || markdownSectionFallbackLabel(idx),
      enabled: true
    });
  });

  return out;
}

function syncHtmlFragments(sectionState, htmlFragments){
  const sections = Array.isArray(sectionState) ? sectionState : [];
  const fragmentsById = new Map(htmlFragments.map((f, idx) => [f.id, { ...f, _idx: idx }]));
  const seen = new Set();
  const out = [];

  sections.forEach(sec => {
    if (!sec?.id || sec.id === "htmlFragments") return;

    if (isHtmlFragmentId(sec.id)) {
      const fragment = fragmentsById.get(sec.id);
      if (!fragment) return;
      out.push({
        ...sec,
        id: fragment.id,
        label: String(fragment.label || "").trim() || htmlFragmentFallbackLabel(fragment._idx),
        enabled: sec.enabled !== false
      });
      seen.add(fragment.id);
      return;
    }

    out.push(sec);
  });

  htmlFragments.forEach((fragment, idx) => {
    if (seen.has(fragment.id)) return;
    out.push({
      id: fragment.id,
      label: String(fragment.label || "").trim() || htmlFragmentFallbackLabel(idx),
      enabled: true
    });
  });

  return out;
}

function normalizeState(raw){
  const fallback = deepClone(DEFAULT_STATE);
  if (!raw || typeof raw !== "object") return fallback;

  const markdownSections = normalizeMarkdownSections(
    Array.isArray(raw.markdownSections) ? raw.markdownSections : fallback.markdownSections
  );
  const htmlFragments = normalizeHtmlFragments(
    Array.isArray(raw.htmlFragments) ? raw.htmlFragments : fallback.htmlFragments
  );
  const sections = syncHtmlFragments(
    syncMarkdownSections(mergeSectionState(raw.sections), markdownSections),
    htmlFragments
  );
  const rawPreviewEditor = (raw.previewEditor && typeof raw.previewEditor === "object")
    ? raw.previewEditor
    : fallback.previewEditor;
  const richOverrides = {};
  if (rawPreviewEditor && typeof rawPreviewEditor.richOverrides === "object") {
    Object.entries(rawPreviewEditor.richOverrides).forEach(([key, value]) => {
      if (!key) return;
      richOverrides[String(key)] = String(value || "");
    });
  }
  const rawPendingElementAction = rawPreviewEditor?.pendingElementAction;
  const pendingElementAction = normalizePendingElementAction(rawPendingElementAction);

  return {
    ...fallback,
    ...raw,
    sections,
    discussion: Array.isArray(raw.discussion) && raw.discussion.length ? raw.discussion : fallback.discussion,
    classes: Array.isArray(raw.classes) && raw.classes.length ? raw.classes : fallback.classes,
    customLinks: Array.isArray(raw.customLinks) && raw.customLinks.length ? raw.customLinks : fallback.customLinks,
    podcasts: Array.isArray(raw.podcasts) && raw.podcasts.length ? raw.podcasts : fallback.podcasts,
    markdownSections,
    htmlFragments,
    previewEditor: {
      enabled: (typeof rawPreviewEditor.enabled === "boolean")
        ? rawPreviewEditor.enabled
        : !!fallback.previewEditor.enabled,
      activeSectionId: String(rawPreviewEditor.activeSectionId || ""),
      pendingElementAction,
      richOverrides
    }
  };
}
  
  let autoRenderTimer = null;

function autoGenerateHtml() {
  clearTimeout(autoRenderTimer);
  autoRenderTimer = setTimeout(() => {
    generateHtml();
  }, 150);
}

function animateReorder(container, renderFn) {
  const items = Array.from(container.children);

  // 1. First: record current positions
  const first = new Map();
  items.forEach(el => {
    first.set(el, el.getBoundingClientRect());
  });

  // 2. Do the DOM update
  renderFn();

  const newItems = Array.from(container.children);

  // 3. Last + Invert
  newItems.forEach(el => {
    const last = el.getBoundingClientRect();
    const prev = first.get(el);

    if (!prev) return;

    const dx = prev.left - last.left;
    const dy = prev.top - last.top;

    if (dx || dy) {
      el.classList.add("moving");
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });

  // 4. Play
  requestAnimationFrame(() => {
    newItems.forEach(el => {
      el.classList.add("animating");
      el.style.transform = "";
    });
  });

  // Cleanup
  setTimeout(() => {
    newItems.forEach(el => {
      el.classList.remove("moving", "animating");
    });
  }, 200);
}

  
/** ------------------------ local preset storage ------------------------ **/
function loadPresets(){
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEYS.presets));
    return normalizePresets(raw);
  } catch {
    return deepClone(DEFAULT_PRESETS);
  }
}

function loadState(){
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEYS.state));
    return normalizeState(raw);
  } catch {
    return deepClone(DEFAULT_STATE);
  }
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escAttr(str) { return escHtml(str).replace(/\s+/g, " ").trim(); }
function byId(list, id){ return list.find(x => x.id === id); }
function slugify(s){
  return String(s ?? "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || ("id_" + Math.random().toString(16).slice(2));
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeProjectName(rawName, fallback = PROJECT_DEFAULT_NAME) {
  const trimmed = String(rawName || "").trim();
  return trimmed || fallback;
}

function createProjectId() {
  return `project_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function captureProjectFieldValues() {
  const values = {};
  PROJECT_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    values[id] = String(el.value ?? "");
  });
  return values;
}

function applyProjectFieldValues(fields) {
  const source = (fields && typeof fields === "object") ? fields : {};
  const defaults = projectFieldDefaults || {};

  PROJECT_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    if (Object.prototype.hasOwnProperty.call(source, id)) {
      el.value = String(source[id] ?? "");
    } else if (Object.prototype.hasOwnProperty.call(defaults, id)) {
      el.value = String(defaults[id] ?? "");
    }

    if (el.tagName === "SELECT") {
      const hasOption = Array.from(el.options || []).some(opt => opt.value === el.value);
      if (!hasOption && el.options.length) el.value = el.options[0].value;
    }
  });
}

function normalizeProjectSnapshot(rawSnapshot) {
  const fallbackState = deepClone(DEFAULT_STATE);
  const fallbackPresets = deepClone(DEFAULT_PRESETS);
  const source = (rawSnapshot && typeof rawSnapshot === "object") ? rawSnapshot : {};
  const rawFields = (source.fields && typeof source.fields === "object") ? source.fields : {};
  const fields = {};
  PROJECT_FIELD_IDS.forEach(id => {
    if (!Object.prototype.hasOwnProperty.call(rawFields, id)) return;
    fields[id] = String(rawFields[id] ?? "");
  });

  return {
    presets: normalizePresets(source.presets || fallbackPresets),
    state: normalizeState(source.state || fallbackState),
    fields
  };
}

function buildSnapshotFromCurrentModels() {
  return normalizeProjectSnapshot({
    presets: deepClone(presets),
    state: deepClone(state),
    fields: captureProjectFieldValues()
  });
}

function buildEmptyProjectSnapshot() {
  return normalizeProjectSnapshot({
    presets: deepClone(DEFAULT_PRESETS),
    state: deepClone(DEFAULT_STATE),
    fields: deepClone(projectFieldDefaults || {})
  });
}

function normalizeProjectFilesystem(rawFs) {
  const source = (rawFs && typeof rawFs === "object") ? rawFs : {};
  const rawProjects = Array.isArray(source.projects) ? source.projects : [];
  const projects = [];
  const usedIds = new Set();

  rawProjects.forEach((rawProject, idx) => {
    if (!rawProject || typeof rawProject !== "object") return;
    let id = String(rawProject.id || "").trim() || `project_${idx + 1}`;
    while (usedIds.has(id)) id = `${id}_${usedIds.size + 1}`;
    usedIds.add(id);

    const name = normalizeProjectName(rawProject.name, `Project ${idx + 1}`);
    const updatedAt = Number(rawProject.updatedAt);
    const snapshot = normalizeProjectSnapshot(rawProject.snapshot);
    projects.push({
      id,
      name,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      snapshot
    });
  });

  return {
    version: PROJECT_STORAGE_VERSION,
    activeProjectId: String(source.activeProjectId || "").trim(),
    projects
  };
}

function saveProjectFilesystem() {
  if (!projectFilesystem || typeof projectFilesystem !== "object") return;
  localStorage.setItem(LS_KEYS.projectsFs, JSON.stringify(projectFilesystem));
}

function loadProjectFilesystem() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEYS.projectsFs));
    return normalizeProjectFilesystem(raw);
  } catch {
    return normalizeProjectFilesystem(null);
  }
}

function getProjectEntryById(projectId) {
  if (!projectFilesystem || !Array.isArray(projectFilesystem.projects)) return null;
  return projectFilesystem.projects.find(project => project.id === projectId) || null;
}

function getActiveProjectEntry() {
  return getProjectEntryById(activeProjectId);
}

function renderProjectFilesystemUI() {
  const select = document.getElementById("projectSelect");
  const nameInput = document.getElementById("projectNameInput");
  const deleteBtn = document.getElementById("deleteProjectBtn");
  if (!select || !nameInput || !projectFilesystem) return;

  select.innerHTML = projectFilesystem.projects
    .map(project => `<option value="${escAttr(project.id)}">${escHtml(project.name)}</option>`)
    .join("");

  if (activeProjectId && getProjectEntryById(activeProjectId)) {
    select.value = activeProjectId;
  } else if (projectFilesystem.projects[0]) {
    activeProjectId = projectFilesystem.projects[0].id;
    select.value = activeProjectId;
  }

  const active = getActiveProjectEntry();
  nameInput.value = active?.name || "";
  if (deleteBtn) deleteBtn.disabled = projectFilesystem.projects.length <= 1;
}

function persistLegacyStorageFromModels() {
  localStorage.setItem(LS_KEYS.presets, JSON.stringify(presets));
  localStorage.setItem(LS_KEYS.state, JSON.stringify(state));
}

function syncActiveProjectSnapshot(options = {}) {
  if (applyingProjectSnapshot) return;
  if (!projectFilesystem || !activeProjectId) return;
  const active = getActiveProjectEntry();
  if (!active) return;

  active.snapshot = buildSnapshotFromCurrentModels();
  active.updatedAt = Date.now();
  projectFilesystem.activeProjectId = activeProjectId;
  saveProjectFilesystem();
  persistLegacyStorageFromModels();
  if (!options.skipUi) renderProjectFilesystemUI();
}

function hydrateUiFromCurrentModels(snapshotFields = null) {
  renderAdminAll();
  renderHighlightMoodOptions();
  applyProjectFieldValues(snapshotFields);
  syncFeatureImageWidthValue();
  bindAutoResizeTextareas(document);
  renderMarkdownSectionsUI();
  renderHtmlFragmentsUI();
  renderSectionsUI();
  renderDiscussionUI();
  renderClassesUI();
  renderCustomLinksUI();
  renderPodcastsUI();
  applyPreviewEditModeUI();
  generateHtml();
}

function switchToProject(projectId, options = {}) {
  const opts = {
    persistCurrent: true,
    ...options
  };

  if (!projectFilesystem) return false;
  if (opts.persistCurrent) syncActiveProjectSnapshot({ skipUi: true });

  const nextProject = getProjectEntryById(projectId);
  if (!nextProject) return false;

  activeProjectId = nextProject.id;
  projectFilesystem.activeProjectId = activeProjectId;

  applyingProjectSnapshot = true;
  presets = normalizePresets(nextProject.snapshot?.presets);
  state = normalizeState(nextProject.snapshot?.state);
  ensurePreviewEditorState();
  hydrateUiFromCurrentModels(nextProject.snapshot?.fields || {});
  applyingProjectSnapshot = false;

  syncActiveProjectSnapshot({ skipUi: true });
  renderProjectFilesystemUI();
  return true;
}

function makeUniqueProjectName(name, ignoreProjectId = "") {
  const baseName = normalizeProjectName(name, PROJECT_DEFAULT_NAME);
  let candidate = baseName;
  let counter = 2;

  while (projectFilesystem?.projects?.some(project =>
    project.id !== ignoreProjectId &&
    String(project.name || "").toLowerCase() === candidate.toLowerCase()
  )) {
    candidate = `${baseName} (${counter})`;
    counter += 1;
  }
  return candidate;
}

function formatTimestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportActiveProjectAsJson() {
  const active = getActiveProjectEntry();
  if (!active) return false;

  syncActiveProjectSnapshot({ skipUi: true });
  const payload = {
    format: PROJECT_EXPORT_FORMAT_SINGLE,
    exportedAt: new Date().toISOString(),
    project: {
      name: active.name,
      snapshot: active.snapshot
    }
  };
  const slug = slugify(active.name || "newsletter-project");
  const filename = `${slug}-${formatTimestampForFilename()}.json`;
  downloadJsonFile(filename, payload);
  return true;
}

function extractImportedProjectRecords(rawPayload) {
  const source = (rawPayload && typeof rawPayload === "object") ? rawPayload : null;
  if (!source) return [];

  if (source.format === PROJECT_EXPORT_FORMAT_SINGLE && source.project && typeof source.project === "object") {
    return [source.project];
  }
  if (source.format === PROJECT_EXPORT_FORMAT_MULTI && Array.isArray(source.projects)) {
    return source.projects;
  }
  if (Array.isArray(source.projects)) {
    return source.projects;
  }
  if (source.project && typeof source.project === "object") {
    return [source.project];
  }
  if (source.snapshot && typeof source.snapshot === "object") {
    return [source];
  }
  if ((source.state && typeof source.state === "object") || (source.presets && typeof source.presets === "object")) {
    return [source];
  }
  return [];
}

function importProjectsFromPayload(rawPayload) {
  if (!projectFilesystem) return [];
  const records = extractImportedProjectRecords(rawPayload);
  if (!records.length) return [];

  const importedProjectIds = [];
  records.forEach((record, idx) => {
    const source = (record && typeof record === "object") ? record : {};
    const snapshotSource = (source.snapshot && typeof source.snapshot === "object") ? source.snapshot : source;
    const snapshot = normalizeProjectSnapshot(snapshotSource);
    const fallbackName = `Imported Project ${projectFilesystem.projects.length + idx + 1}`;
    const uniqueName = makeUniqueProjectName(normalizeProjectName(source.name, fallbackName));
    const project = {
      id: createProjectId(),
      name: uniqueName,
      updatedAt: Date.now(),
      snapshot
    };
    projectFilesystem.projects.push(project);
    importedProjectIds.push(project.id);
  });

  saveProjectFilesystem();
  return importedProjectIds;
}

function createProjectFromCurrent(name) {
  const baseName = normalizeProjectName(name, `Project ${projectFilesystem.projects.length + 1}`);
  const uniqueName = makeUniqueProjectName(baseName);
  const project = {
    id: createProjectId(),
    name: uniqueName,
    updatedAt: Date.now(),
    snapshot: buildSnapshotFromCurrentModels()
  };
  projectFilesystem.projects.push(project);
  return project;
}

function createBlankProject(name) {
  const baseName = normalizeProjectName(name, `Project ${projectFilesystem.projects.length + 1}`);
  const uniqueName = makeUniqueProjectName(baseName);
  const project = {
    id: createProjectId(),
    name: uniqueName,
    updatedAt: Date.now(),
    snapshot: buildEmptyProjectSnapshot()
  };
  projectFilesystem.projects.push(project);
  return project;
}

function initProjectFilesystem() {
  projectFilesystem = loadProjectFilesystem();

  if (!projectFilesystem.projects.length) {
    const firstProject = {
      id: createProjectId(),
      name: PROJECT_DEFAULT_NAME,
      updatedAt: Date.now(),
      snapshot: normalizeProjectSnapshot({
        presets: deepClone(presets),
        state: deepClone(state),
        fields: captureProjectFieldValues()
      })
    };
    projectFilesystem.projects = [firstProject];
    projectFilesystem.activeProjectId = firstProject.id;
    saveProjectFilesystem();
  }

  activeProjectId = projectFilesystem.activeProjectId;
  if (!getProjectEntryById(activeProjectId)) {
    activeProjectId = projectFilesystem.projects[0]?.id || "";
    projectFilesystem.activeProjectId = activeProjectId;
  }

  const active = getActiveProjectEntry();
  if (active?.snapshot) {
    presets = normalizePresets(active.snapshot.presets);
    state = normalizeState(active.snapshot.state);
  }
}

function renderHighlightMoodOptions(){
  const select = document.getElementById("highlight_mood");
  if (!select) return;

  const previous = select.value;
  const moods = Array.isArray(presets?.moods) ? presets.moods : [];
  select.innerHTML = moods.map(m =>
    `<option value="${escAttr(m.id)}">${escHtml(m.label || m.id)}</option>`
  ).join("");

  const fallback = moods.find(m => m.id === "none")?.id || moods[0]?.id || "";
  const hasPrevious = moods.some(m => m.id === previous);
  select.value = hasPrevious ? previous : fallback;
}

function syncFeatureImageWidthValue() {
  const slider = document.getElementById("feature_img_width");
  const valueEl = document.getElementById("feature_img_width_value");
  if (!slider || !valueEl) return;
  valueEl.textContent = `${slider.value}px`;
}

const autoResizeTextareaRegistry = new Set();
let autoResizeWindowBound = false;

function resizeTextareaToContent(textarea) {
  if (!textarea) return;
  const prevScrollTop = textarea.scrollTop;
  textarea.style.height = "auto";
  const computed = window.getComputedStyle(textarea);
  const minHeight = parseFloat(computed.minHeight) || 0;
  const nextHeight = Math.max(textarea.scrollHeight, minHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.scrollTop = prevScrollTop;
}

function bindAutoResizeTextarea(textarea) {
  if (!textarea || textarea.dataset.autoResizeBound === "true") return;
  textarea.dataset.autoResizeBound = "true";

  const onInput = () => resizeTextareaToContent(textarea);
  textarea.addEventListener("input", onInput);
  autoResizeTextareaRegistry.add(textarea);
  onInput();

  if (!autoResizeWindowBound) {
    autoResizeWindowBound = true;
    window.addEventListener("resize", () => {
      autoResizeTextareaRegistry.forEach(el => {
        if (!document.contains(el)) {
          autoResizeTextareaRegistry.delete(el);
          return;
        }
        resizeTextareaToContent(el);
      });
    });
  }
}

function bindAutoResizeTextareas(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("textarea").forEach(bindAutoResizeTextarea);
}

const PREVIEW_PLAIN_KEY_TO_INPUT_ID = Object.freeze({
  "highlight.label": "highlight_label",
  "highlight.title": "highlight_title",
  "highlight.username": "highlight_username",
  "highlight.button": "highlight_button",
  "feature.header": "feature_header",
  "feature.cta1Text": "feature_cta_text_1",
  "feature.cta2Text": "feature_cta_text_2",
  "discussion.header": "discussion_label"
});

const RICH_OVERRIDE_KEYS_BY_INPUT_ID = Object.freeze({
  highlight_summary: ["highlight.summary"],
  in_this_newsletter_markdown: ["inThisNewsletter.body"],
  feature_top_text: ["feature.topText"],
  feature_bottom_text: ["feature.bottomText"],
  blog_desc: ["admissionsBlog.body"]
});

const ALLOWED_RICH_TAGS = new Set(["p", "br", "strong", "em", "ul", "ol", "li", "a", "h2", "h3", "h4", "code"]);

function ensurePreviewEditorState() {
  if (!state.previewEditor || typeof state.previewEditor !== "object") {
    state.previewEditor = { enabled: false, activeSectionId: "", pendingElementAction: null, richOverrides: {} };
  }
  if (typeof state.previewEditor.activeSectionId !== "string") {
    state.previewEditor.activeSectionId = "";
  }
  state.previewEditor.pendingElementAction = normalizePendingElementAction(state.previewEditor.pendingElementAction);
  if (!state.previewEditor.richOverrides || typeof state.previewEditor.richOverrides !== "object") {
    state.previewEditor.richOverrides = {};
  }
  return state.previewEditor;
}

function previewMarkdownLabelKey(sectionId) {
  return `markdownSection.${sectionId}.label`;
}

function previewMarkdownRichKey(sectionId) {
  return `markdownSection.${sectionId}.body`;
}

function getRichOverrideValue(key) {
  const overrides = ensurePreviewEditorState().richOverrides;
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return String(overrides[key] || "");
  }
  return null;
}

function getRichContentForRender(key, fallbackHtml) {
  const override = getRichOverrideValue(key);
  if (override !== null) return override;
  return String(fallbackHtml || "");
}

function setRichOverrideValue(key, html) {
  if (!key) return false;
  const editor = ensurePreviewEditorState();
  const next = String(html || "");
  if (editor.richOverrides[key] === next) return false;
  editor.richOverrides[key] = next;
  saveState();
  return true;
}

function clearRichOverrideValue(key) {
  if (!key) return false;
  const editor = ensurePreviewEditorState();
  if (!Object.prototype.hasOwnProperty.call(editor.richOverrides, key)) return false;
  delete editor.richOverrides[key];
  saveState();
  return true;
}

function clearLinkedRichOverridesForInput(target) {
  let changed = false;

  if (target?.id && Array.isArray(RICH_OVERRIDE_KEYS_BY_INPUT_ID[target.id])) {
    RICH_OVERRIDE_KEYS_BY_INPUT_ID[target.id].forEach(key => {
      if (clearRichOverrideValue(key)) changed = true;
    });
  }

  if (target?.dataset?.markdownK === "markdown") {
    const block = target.closest("details[data-markdown-section-id]");
    const sectionId = block?.dataset?.markdownSectionId;
    if (sectionId && clearRichOverrideValue(previewMarkdownRichKey(sectionId))) {
      changed = true;
    }
  }

  return changed;
}

function wrapEditablePlain(html, key, interactive) {
  if (!interactive || !key) return html;
  return `<span data-edit-key="${escAttr(key)}">${html || ""}</span>`;
}

function wrapEditableRich(html, key, interactive) {
  if (!interactive || !key) return html || "";
  return `<div data-edit-rich-key="${escAttr(key)}">${html || ""}</div>`;
}

function normalizePreviewPlainText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function applyPlainPreviewEdit(key, textValue) {
  const value = normalizePreviewPlainText(textValue);
  const mappedInputId = PREVIEW_PLAIN_KEY_TO_INPUT_ID[key];

  if (mappedInputId) {
    const input = document.getElementById(mappedInputId);
    if (!input) return false;
    input.value = value;
    saveState();
    return true;
  }

  const markdownLabelMatch = String(key || "").match(/^markdownSection\.([^.]+)\.label$/);
  if (markdownLabelMatch) {
    const sectionId = markdownLabelMatch[1];
    const section = state.markdownSections.find(x => x.id === sectionId);
    if (!section) return false;
    section.label = value;
    const sectionIndex = state.markdownSections.findIndex(x => x.id === sectionId);
    const sectionEntry = state.sections.find(x => x.id === sectionId);
    if (sectionEntry) sectionEntry.label = markdownSectionSummary(section, sectionIndex);
    saveState();
    renderMarkdownSectionsUI();
    renderSectionsUI();
    return true;
  }

  const htmlFragmentLabelMatch = String(key || "").match(/^htmlFragment\.([^.]+)\.label$/);
  if (htmlFragmentLabelMatch) {
    const fragmentId = htmlFragmentLabelMatch[1];
    const fragment = state.htmlFragments.find(x => x.id === fragmentId);
    if (!fragment) return false;
    fragment.label = value;
    const fragmentIndex = state.htmlFragments.findIndex(x => x.id === fragmentId);
    const sectionEntry = state.sections.find(x => x.id === fragmentId);
    if (sectionEntry) sectionEntry.label = htmlFragmentSummary(fragment, fragmentIndex);
    saveState();
    renderHtmlFragmentsUI();
    renderSectionsUI();
    return true;
  }

  return false;
}

function sanitizeRichHtmlFragment(rawHtml) {
  const template = document.createElement("template");
  template.innerHTML = String(rawHtml || "");
  const out = document.createElement("div");

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const sourceTag = node.tagName.toLowerCase();
    // Contenteditable often emits <div> for line breaks; normalize it to <p>.
    const tag = sourceTag === "div" ? "p" : sourceTag;
    if (!ALLOWED_RICH_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      Array.from(node.childNodes).forEach(child => fragment.appendChild(cleanNode(child)));
      return fragment;
    }

    const clean = document.createElement(tag);
    const styleAttr = node.getAttribute("style");
    if (styleAttr) clean.setAttribute("style", styleAttr);

    if (tag === "a") {
      const href = String(node.getAttribute("href") || "").trim();
      if (/^https?:\/\//i.test(href)) {
        clean.setAttribute("href", href);
      }
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer");
    }

    Array.from(node.childNodes).forEach(child => clean.appendChild(cleanNode(child)));
    return clean;
  };

  Array.from(template.content.childNodes).forEach(child => out.appendChild(cleanNode(child)));
  return out.innerHTML.trim();
}

function addPreviewEditorStyles(doc) {
  if (!doc || doc.getElementById("previewEditorStyles")) return;
  const style = doc.createElement("style");
  style.id = "previewEditorStyles";
  style.textContent = `
    [data-preview-right-rail]{
      position:fixed;
      top:16px;
      right:16px;
      width:min(320px, calc(100vw - 32px));
      display:flex;
      flex-direction:column;
      gap:10px;
      z-index:2147483646;
    }
    [data-preview-library-box]{
      width:100%;
      max-height:34vh;
      overflow:auto;
      border:1px solid #d0d5dd;
      border-radius:12px;
      background:#ffffff;
      padding:10px 12px;
      box-shadow:0 1px 3px rgba(16,24,40,.06);
      z-index:2147483646;
    }
    [data-preview-library-title]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      letter-spacing:.3px;
      font-weight:800;
      color:#344054;
      margin-bottom:8px;
    }
    [data-preview-library-list]{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
    }
    [data-section-library-item]{
      display:inline-block;
      border:1px solid #d0d5dd;
      border-radius:999px;
      padding:5px 10px;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      font-weight:700;
      color:#344054;
      background:#f8fafc;
      cursor:grab;
      user-select:none;
    }
    [data-section-library-item]:active{
      cursor:grabbing;
    }
    [data-preview-library-empty]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      color:#667085;
    }
    [data-preview-element-box]{
      width:100%;
      max-height:34vh;
      overflow:auto;
      border:1px solid #d0d5dd;
      border-radius:12px;
      background:#ffffff;
      padding:10px 12px;
      box-shadow:0 1px 3px rgba(16,24,40,.06);
    }
    [data-preview-element-title]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      letter-spacing:.3px;
      font-weight:800;
      color:#344054;
      margin-bottom:8px;
    }
    [data-preview-element-list]{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
    }
    [data-element-library-item]{
      display:inline-block;
      border:1px solid #d0d5dd;
      border-radius:999px;
      padding:5px 10px;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      font-weight:700;
      color:#344054;
      background:#f8fafc;
      cursor:grab;
      user-select:none;
    }
    [data-element-library-item]:active{
      cursor:grabbing;
    }
    [data-preview-element-hint]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      color:#667085;
      margin-top:8px;
      line-height:1.45;
    }
    [data-highlight-author-tray]{
      position:fixed;
      top:16px;
      left:16px;
      width:min(320px, calc(100vw - 32px));
      box-sizing:border-box;
      overflow:hidden;
      border:1px solid #d0d5dd;
      border-radius:12px;
      background:#ffffff;
      padding:10px 12px;
      box-shadow:0 1px 3px rgba(16,24,40,.06);
      z-index:2147483645;
    }
    [data-highlight-author-title]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      letter-spacing:.3px;
      font-weight:800;
      color:#344054;
      margin-bottom:8px;
    }
    [data-highlight-author-row]{
      margin-bottom:8px;
      min-width:0;
    }
    [data-highlight-author-row] label{
      display:block;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      color:#667085;
      font-weight:700;
      margin-bottom:4px;
    }
    [data-highlight-author-row] input,
    [data-highlight-author-row] select{
      display:block;
      width:100%;
      max-width:100%;
      min-width:0;
      box-sizing:border-box;
      border:1px solid #d0d5dd;
      border-radius:8px;
      background:#fff;
      color:#344054;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      padding:7px 9px;
    }
    [data-highlight-author-row] input:focus,
    [data-highlight-author-row] select:focus{
      outline:none;
      border-color:#227f9c;
      box-shadow:0 0 0 2px rgba(34,127,156,.15);
    }
    [data-highlight-author-actions]{
      display:flex;
      gap:8px;
      justify-content:flex-end;
    }
    [data-highlight-author-actions] button{
      border:1px solid #d0d5dd;
      border-radius:8px;
      background:#fff;
      color:#344054;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      font-weight:700;
      padding:6px 8px;
      cursor:pointer;
    }
    [data-highlight-author-actions] button:hover{
      background:#f8fafc;
    }
    [data-discussion-tray]{
      position:fixed;
      left:16px;
      top:132px;
      width:min(380px, calc(100vw - 32px));
      max-height:calc(100vh - 148px);
      box-sizing:border-box;
      overflow:auto;
      border:1px solid #d0d5dd;
      border-radius:12px;
      background:#ffffff;
      padding:10px 12px;
      box-shadow:0 1px 3px rgba(16,24,40,.06);
      z-index:2147483644;
    }
    [data-discussion-tray-title]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      letter-spacing:.3px;
      font-weight:800;
      color:#344054;
      margin-bottom:8px;
    }
    [data-discussion-tray-post]{
      border:1px solid #eaecf0;
      border-radius:10px;
      padding:8px;
      margin-bottom:8px;
      background:#fff;
    }
    [data-discussion-tray-head]{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      margin-bottom:6px;
    }
    [data-discussion-tray-head] strong{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      color:#344054;
      font-weight:800;
    }
    [data-discussion-tray-grid]{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:6px;
      margin-bottom:6px;
    }
    [data-discussion-tray-row]{
      min-width:0;
    }
    [data-discussion-tray-row] label{
      display:block;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      color:#667085;
      font-weight:700;
      margin-bottom:3px;
    }
    [data-discussion-tray-row] input,
    [data-discussion-tray-row] select{
      display:block;
      width:100%;
      max-width:100%;
      min-width:0;
      box-sizing:border-box;
      border:1px solid #d0d5dd;
      border-radius:8px;
      background:#fff;
      color:#344054;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      padding:7px 9px;
    }
    [data-discussion-tray-row] input:focus,
    [data-discussion-tray-row] select:focus{
      outline:none;
      border-color:#227f9c;
      box-shadow:0 0 0 2px rgba(34,127,156,.15);
    }
    [data-discussion-tray-actions]{
      display:flex;
      gap:8px;
      justify-content:flex-end;
      margin-top:8px;
    }
    [data-discussion-tray-empty]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      color:#667085;
      line-height:1.45;
      margin:6px 0 4px;
    }
    [data-discussion-tray-actions] button,
    [data-discussion-tray-remove],
    [data-discussion-tray-clear-post]{
      border:1px solid #d0d5dd;
      border-radius:8px;
      background:#fff;
      color:#344054;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      font-weight:700;
      padding:6px 8px;
      cursor:pointer;
    }
    [data-discussion-tray-remove]:hover{
      background:#fff1f2;
      color:#b42318;
      border-color:#fda29b;
    }
    [data-discussion-tray-actions] button:hover,
    [data-discussion-tray-clear-post]:hover{
      background:#f8fafc;
    }
    [data-section-drag-handle]{
      display:inline-block;
      border:1px dashed #bfcfd8;
      border-radius:999px;
      padding:4px 10px;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      font-weight:700;
      color:#344054;
      background:#f8fafc;
      cursor:grab;
      user-select:none;
    }
    [data-section-drag-handle]:active{
      cursor:grabbing;
    }
    [data-section-block].dragging{
      opacity:.45;
    }
    [data-section-block].element-drag-over [data-section-shell]{
      outline:2px solid #227f9c;
      outline-offset:3px;
      border-radius:12px;
    }
    [data-section-shell]{
      position:relative;
    }
    [data-section-remove-btn]{
      position:absolute;
      top:6px;
      right:8px;
      width:24px;
      height:24px;
      border:1px solid #d0d5dd;
      border-radius:999px;
      background:#ffffff;
      color:#344054;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:14px;
      font-weight:800;
      line-height:1;
      display:flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
      opacity:0;
      pointer-events:none;
      transition:opacity .12s ease;
      box-shadow:0 1px 2px rgba(16,24,40,.08);
      z-index:3;
    }
    [data-section-block]:hover [data-section-remove-btn]{
      opacity:1;
      pointer-events:auto;
    }
    [data-section-remove-btn]:hover{
      background:#fff1f2;
      color:#b42318;
      border-color:#fda29b;
    }
    [data-section-dropzone]{
      height:8px;
      margin:4px 16px;
      border:1px dashed transparent;
      border-radius:8px;
      transition:all .12s ease;
    }
    [data-section-dropzone-index].drag-over [data-section-dropzone]{
      height:22px;
      border-color:#227f9c;
      background:#eaf4f8;
    }
    [data-preview-context-menu]{
      position:fixed;
      min-width:180px;
      border:1px solid #d0d5dd;
      border-radius:10px;
      background:#ffffff;
      box-shadow:0 8px 18px rgba(16,24,40,.18);
      padding:6px;
      z-index:2147483647;
    }
    [data-preview-context-menu] button{
      display:block;
      width:100%;
      text-align:left;
      border:0;
      background:transparent;
      border-radius:8px;
      padding:8px 10px;
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:12px;
      font-weight:700;
      color:#344054;
      cursor:pointer;
    }
    [data-preview-context-menu] button:hover{
      background:#f2f4f7;
    }
    [data-preview-context-menu] button[disabled]{
      color:#98a2b3;
      cursor:not-allowed;
    }
    [data-preview-context-menu] button[disabled]:hover{
      background:transparent;
    }
    [data-preview-context-menu-title]{
      font-family:'Lexend', Helvetica, Arial, sans-serif;
      font-size:11px;
      color:#667085;
      font-weight:700;
      padding:4px 10px 6px 10px;
      border-bottom:1px solid #eaecf0;
      margin-bottom:4px;
    }
    [data-edit-key], [data-edit-rich-key]{
      outline: 1px dashed #9fb8c5;
      outline-offset: 3px;
      border-radius: 4px;
      cursor: text;
    }
    [data-edit-key]:focus, [data-edit-rich-key]:focus{
      outline: 2px solid #227f9c;
    }
    [data-edit-rich-key]{
      min-height: 14px;
    }
  `;
  doc.head.appendChild(style);
}

function ensurePreviewFonts(doc) {
  if (!doc || doc.getElementById("previewFontStylesheet")) return;
  const link = doc.createElement("link");
  link.id = "previewFontStylesheet";
  link.rel = "stylesheet";
  link.href = PREVIEW_FONT_STYLESHEET_HREF;
  doc.head.appendChild(link);
}

function bindPreviewEditorInteractions() {
  const frame = document.getElementById("preview");
  const doc = frame?.contentDocument;
  if (!doc) return;
  ensurePreviewFonts(doc);

  const previewEditor = ensurePreviewEditorState();
  if (!previewEditor.enabled) return;

  addPreviewEditorStyles(doc);

  doc.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link) {
      event.preventDefault();
    }
  }, true);

  const clearDropHighlights = () => {
    doc.querySelectorAll("[data-section-dropzone-index].drag-over").forEach(node => {
      node.classList.remove("drag-over");
    });
    doc.querySelectorAll("[data-section-block].element-drag-over").forEach(node => {
      node.classList.remove("element-drag-over");
    });
  };
  let activeDragPayload = null;
  const findSectionBlock = (sectionId) => {
    return Array.from(doc.querySelectorAll("[data-section-block]"))
      .find(node => String(node.dataset.sectionId || "") === sectionId);
  };
  const rightRail = doc.createElement("div");
  rightRail.dataset.previewRightRail = "true";
  const sectionLibraryWrap = doc.createElement("div");
  sectionLibraryWrap.innerHTML = buildPreviewSectionLibraryHtml();
  const sectionLibrary = sectionLibraryWrap.firstElementChild;
  if (sectionLibrary) {
    rightRail.appendChild(sectionLibrary);
  }
  const elementLibraryWrap = doc.createElement("div");
  elementLibraryWrap.innerHTML = buildPreviewElementLibraryHtml();
  const elementLibrary = elementLibraryWrap.firstElementChild;
  if (elementLibrary) {
    rightRail.appendChild(elementLibrary);
  }
  if (rightRail.childElementCount > 0) {
    doc.body.appendChild(rightRail);
  }
  const contextMenu = doc.createElement("div");
  contextMenu.dataset.previewContextMenu = "true";
  contextMenu.hidden = true;
  doc.body.appendChild(contextMenu);
  let contextSectionId = "";

  const hideContextMenu = () => {
    contextMenu.hidden = true;
    contextMenu.innerHTML = "";
    contextSectionId = "";
  };

  const positionContextMenu = (x, y) => {
    const maxX = Math.max(8, doc.documentElement.clientWidth - contextMenu.offsetWidth - 8);
    const maxY = Math.max(8, doc.documentElement.clientHeight - contextMenu.offsetHeight - 8);
    const left = Math.max(8, Math.min(x, maxX));
    const top = Math.max(8, Math.min(y, maxY));
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  };

  doc.querySelectorAll("[data-section-drag-handle]").forEach(handle => {
    const sectionId = String(handle.dataset.sectionId || "");
    if (!sectionId) return;
    handle.setAttribute("draggable", "true");

    handle.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `existing:${sectionId}`);
      event.dataTransfer.effectAllowed = "move";
      activeDragPayload = { kind: "existing", sectionId };
      const block = findSectionBlock(sectionId);
      if (block) block.classList.add("dragging");
    });

    handle.addEventListener("dragend", () => {
      const block = findSectionBlock(sectionId);
      if (block) block.classList.remove("dragging");
      activeDragPayload = null;
      clearDropHighlights();
    });
  });

  doc.querySelectorAll("[data-section-library-item]").forEach(item => {
    const sectionId = String(item.dataset.sectionLibraryItem || "");
    if (!sectionId) return;
    item.setAttribute("draggable", "true");

    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `library:${sectionId}`);
      event.dataTransfer.effectAllowed = "copyMove";
      activeDragPayload = { kind: "library", sectionId };
    });

    item.addEventListener("dragend", () => {
      activeDragPayload = null;
      clearDropHighlights();
    });
  });

  doc.querySelectorAll("[data-element-library-item]").forEach(item => {
    const elementType = String(item.dataset.elementLibraryItem || "");
    if (!elementType) return;
    item.setAttribute("draggable", "true");

    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `element:${elementType}`);
      event.dataTransfer.effectAllowed = "copy";
      activeDragPayload = { kind: "element", elementType };
    });

    item.addEventListener("dragend", () => {
      activeDragPayload = null;
      clearDropHighlights();
    });
  });

  doc.querySelectorAll("[data-section-remove-btn]").forEach(button => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sectionId = String(button.dataset.sectionId || "");
      if (!sectionId) return;
      const changed = disableSectionById(sectionId);
      if (!changed) return;
      saveState();
      renderSectionsUI();
      generateHtml();
    });
  });

  doc.querySelectorAll("[data-section-dropzone-index]").forEach(zone => {
    zone.addEventListener("dragover", (event) => {
      const payload = activeDragPayload || previewDragPayloadFromEvent(event);
      if (!payload) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = payload.kind === "element" ? "copy" : "move";
      zone.classList.add("drag-over");
    });

    zone.addEventListener("dragenter", (event) => {
      if (!(activeDragPayload || previewDragPayloadFromEvent(event))) return;
      zone.classList.add("drag-over");
    });

    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) {
        zone.classList.remove("drag-over");
      }
    });

    zone.addEventListener("drop", (event) => {
      const payload = previewDragPayloadFromEvent(event) || activeDragPayload;
      if (!payload) return;
      event.preventDefault();
      activeDragPayload = null;
      clearDropHighlights();

      const targetIndex = Number(zone.dataset.sectionDropzoneIndex || "0");
      let changed = false;
      let activeSectionId = "";

      if (payload.kind === "existing") {
        changed = moveEnabledSectionToIndex(payload.sectionId, targetIndex);
        activeSectionId = payload.sectionId;
      } else if (payload.kind === "library") {
        const insertedSectionId = insertLibraryItemAtIndex(payload.sectionId, targetIndex);
        changed = !!insertedSectionId;
        activeSectionId = insertedSectionId;
      } else if (payload.kind === "element") {
        changed = openPendingElementAction(payload.elementType, {
          targetEnabledIndex: targetIndex
        });
      }

      if (!changed) return;
      if (payload.kind === "element") return;
      saveState();
      renderMarkdownSectionsUI();
      renderHtmlFragmentsUI();
      renderSectionsUI();
      if (activeSectionId) setActivePreviewSection(activeSectionId);
      generateHtml();
    });
  });

  doc.querySelectorAll("[data-section-block][data-section-id]").forEach(block => {
    const sectionId = String(block.dataset.sectionId || "");
    if (!sectionId) return;

    block.addEventListener("dragover", (event) => {
      const payload = activeDragPayload || previewDragPayloadFromEvent(event);
      if (!payload || payload.kind !== "element") return;
      if (!sectionSupportsElementDrop(sectionId, payload.elementType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      block.classList.add("element-drag-over");
    });

    block.addEventListener("dragenter", (event) => {
      const payload = activeDragPayload || previewDragPayloadFromEvent(event);
      if (!payload || payload.kind !== "element") return;
      if (!sectionSupportsElementDrop(sectionId, payload.elementType)) return;
      block.classList.add("element-drag-over");
    });

    block.addEventListener("dragleave", (event) => {
      if (!block.contains(event.relatedTarget)) {
        block.classList.remove("element-drag-over");
      }
    });

    block.addEventListener("drop", (event) => {
      const payload = previewDragPayloadFromEvent(event) || activeDragPayload;
      if (!payload || payload.kind !== "element") return;
      if (!sectionSupportsElementDrop(sectionId, payload.elementType)) return;
      event.preventDefault();
      event.stopPropagation();
      activeDragPayload = null;
      clearDropHighlights();

      let changed = false;
      if (payload.elementType === ELEMENT_LIBRARY_ITEM_CTA) {
        changed = openPendingElementAction(ELEMENT_LIBRARY_ITEM_CTA, {
          targetSectionId: sectionId
        });
      } else if (payload.elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
        changed = openPendingElementAction(ELEMENT_LIBRARY_ITEM_IMAGE, {
          targetSectionId: sectionId
        });
      } else if (payload.elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
        changed = openPendingElementAction(ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT, {
          targetSectionId: sectionId
        });
      } else if (payload.elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
        changed = openPendingElementAction(ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT, {
          targetSectionId: sectionId
        });
      }

      if (!changed) return;
    });
  });

  doc.querySelectorAll("[data-section-block][data-section-id]").forEach(block => {
    block.addEventListener("click", (event) => {
      const sectionId = String(block.dataset.sectionId || "");
      if (!sectionId) return;
      if (event.target.closest("[data-section-remove-btn]")) return;
      setActivePreviewSection(sectionId);
    }, true);
  });

  doc.addEventListener("contextmenu", (event) => {
    const block = event.target.closest("[data-section-block][data-section-id]");
    if (!block) {
      hideContextMenu();
      return;
    }

    event.preventDefault();
    const sectionId = String(block.dataset.sectionId || "");
    contextSectionId = sectionId;
    setActivePreviewSection(sectionId);
    const supported = sectionSupportsInlineCta(sectionId);
    const supportsHighlightAuthorMeta = sectionId === "highlight";
    const sectionIdx = state.sections.findIndex(section => section.id === sectionId);
    const sectionEntry = sectionIdx >= 0 ? state.sections[sectionIdx] : null;
    const sectionLabel = sectionDisplayLabel(sectionEntry, sectionIdx >= 0 ? sectionIdx : 0) || sectionId;

    contextMenu.innerHTML = `
      <div data-preview-context-menu-title>${escHtml(sectionLabel)}</div>
      <button type="button" data-preview-context-action="addCta" ${supported ? "" : "disabled"}>
        Add CTA Link
      </button>
      <button type="button" data-preview-context-action="addHighlightAuthorMeta" ${supportsHighlightAuthorMeta ? "" : "disabled"}>
        Add Avatar + Name + Mood
      </button>
    `;
    contextMenu.hidden = false;
    positionContextMenu(event.clientX, event.clientY);
  }, true);

  contextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-preview-context-action]");
    if (!button || button.disabled) return;

    const action = String(button.dataset.previewContextAction || "");
    const sectionId = contextSectionId;
    hideContextMenu();
    if (action === "addCta" && sectionId) {
      openPendingElementAction(ELEMENT_LIBRARY_ITEM_CTA, {
        targetSectionId: sectionId
      });
    } else if (action === "addHighlightAuthorMeta" && sectionId === "highlight") {
      addHighlightAuthorMetaFromPreview();
    }
  });

  doc.addEventListener("click", (event) => {
    if (contextMenu.hidden) return;
    if (contextMenu.contains(event.target)) return;
    hideContextMenu();
  }, true);
  doc.addEventListener("scroll", hideContextMenu, true);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
  });

  doc.querySelectorAll("[data-edit-key]").forEach(node => {
    node.setAttribute("contenteditable", "true");
    node.setAttribute("spellcheck", "true");

    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });

    node.addEventListener("input", () => {
      applyPlainPreviewEdit(node.dataset.editKey, node.textContent || "");
    });

    node.addEventListener("blur", () => {
      const changed = applyPlainPreviewEdit(node.dataset.editKey, node.textContent || "");
      if (changed) {
        renderSectionsUI();
        autoGenerateHtml();
      }
    });
  });

  doc.querySelectorAll("[data-edit-rich-key]").forEach(node => {
    node.setAttribute("contenteditable", "true");
    node.setAttribute("spellcheck", "true");

    node.addEventListener("input", () => {
      const key = node.dataset.editRichKey;
      const sanitized = sanitizeRichHtmlFragment(node.innerHTML);
      setRichOverrideValue(key, sanitized);
    });

    node.addEventListener("blur", () => {
      const key = node.dataset.editRichKey;
      const sanitized = sanitizeRichHtmlFragment(node.innerHTML);
      const changed = setRichOverrideValue(key, sanitized);
      if (changed) {
        autoGenerateHtml();
      } else {
        generateHtml();
      }
    });
  });
}

function ensurePreviewSectionTrayEmptyState(panel) {
  if (!panel) return null;
  let emptyState = panel.querySelector("[data-preview-section-tray-empty]");
  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.dataset.previewSectionTrayEmpty = "true";
    emptyState.className = "small";
    emptyState.textContent = "Click any section in the preview to edit its card.";
    panel.appendChild(emptyState);
  }
  return emptyState;
}

function ensurePreviewElementActionTray(panel) {
  if (!panel) return null;
  let tray = panel.querySelector("[data-preview-element-action-tray]");
  if (!tray) {
    tray = document.createElement("div");
    tray.dataset.previewElementActionTray = "true";
    tray.className = "row section-manager";
    const firstSectionBlock = panel.querySelector("details[data-section-id]");
    if (firstSectionBlock) panel.insertBefore(tray, firstSectionBlock);
    else panel.appendChild(tray);
  }
  return tray;
}

function getSectionCtaDefaults(sectionId) {
  if (isMarkdownSectionId(sectionId)) {
    const section = state.markdownSections.find(item => item.id === sectionId);
    return {
      ctaText: String(section?.ctaText || "Learn more"),
      ctaUrl: String(section?.ctaUrl || "")
    };
  }
  if (sectionId === "featureSlot") {
    const cta1Text = String(document.getElementById("feature_cta_text_1")?.value || "");
    const cta1Url = String(document.getElementById("feature_cta_url_1")?.value || "");
    const cta2Text = String(document.getElementById("feature_cta_text_2")?.value || "");
    const cta2Url = String(document.getElementById("feature_cta_url_2")?.value || "");
    if (cta1Url) return { ctaText: cta1Text || "Learn more", ctaUrl: cta1Url };
    if (cta2Url) return { ctaText: cta2Text || "Learn more", ctaUrl: cta2Url };
    return { ctaText: cta1Text || "Learn more", ctaUrl: "" };
  }
  if (sectionId === "highlight") {
    return {
      ctaText: String(document.getElementById("highlight_button")?.value || "View post"),
      ctaUrl: String(document.getElementById("highlight_url")?.value || "")
    };
  }
  if (sectionId === "customLinks") {
    const last = Array.isArray(state.customLinks) && state.customLinks.length
      ? state.customLinks[state.customLinks.length - 1]
      : null;
    return {
      ctaText: String(last?.linkText || "Learn more"),
      ctaUrl: String(last?.url || "")
    };
  }
  return {
    ctaText: "Learn more",
    ctaUrl: ""
  };
}

function buildPendingElementAction(elementType, options = {}) {
  const next = {
    elementType: String(elementType || ""),
    targetSectionId: String(options.targetSectionId || ""),
    targetEnabledIndex: Number.isFinite(Number(options.targetEnabledIndex))
      ? Math.max(0, Math.round(Number(options.targetEnabledIndex)))
      : null,
    values: {
      ...defaultPendingElementValues(elementType),
      ...(options.values && typeof options.values === "object" ? options.values : {})
    }
  };

  if (next.targetSectionId) {
    if (elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
      next.values = {
        ...defaultPendingElementValues(elementType),
        ...(getSectionImageDefaults(next.targetSectionId) || {})
      };
    } else if (elementType === ELEMENT_LIBRARY_ITEM_CTA) {
      next.values = {
        ...defaultPendingElementValues(elementType),
        ...getSectionCtaDefaults(next.targetSectionId)
      };
    } else if (elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
      const section = state.markdownSections.find(item => item.id === next.targetSectionId);
      next.values = { markdown: String(section?.markdown || "") };
    } else if (elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
      const section = state.markdownSections.find(item => item.id === next.targetSectionId);
      next.values = { htmlFragment: String(section?.htmlFragment || "") };
    }
  }

  if (options.values && typeof options.values === "object") {
    next.values = { ...next.values, ...options.values };
  }

  return normalizePendingElementAction(next);
}

function setPendingElementAction(action, options = {}) {
  const opts = {
    save: true,
    ...options
  };
  const editor = ensurePreviewEditorState();
  editor.pendingElementAction = normalizePendingElementAction(action);
  if (opts.save) saveState();
  applyPreviewSectionTrayUI();
}

function clearPendingElementAction(options = {}) {
  const opts = {
    save: true,
    ...options
  };
  setPendingElementAction(null, { save: opts.save });
}

function openPendingElementAction(elementType, options = {}) {
  const action = buildPendingElementAction(elementType, options);
  if (!action) return false;
  const targetSectionId = String(action.targetSectionId || "");
  if (targetSectionId) setActivePreviewSection(targetSectionId, { save: false });
  setPendingElementAction(action, { save: false });
  saveState();
  return true;
}

function pendingElementActionTargetLabel(action) {
  if (!action) return "";
  if (action.targetSectionId) {
    const sectionIdx = state.sections.findIndex(section => section.id === action.targetSectionId);
    const sectionEntry = sectionIdx >= 0 ? state.sections[sectionIdx] : null;
    return sectionDisplayLabel(sectionEntry, sectionIdx >= 0 ? sectionIdx : 0) || action.targetSectionId;
  }
  return "New Blank Section";
}

function buildPendingElementActionTrayHtml(action) {
  const targetLabel = escHtml(pendingElementActionTargetLabel(action));
  const values = (action?.values && typeof action.values === "object") ? action.values : {};
  const elementType = String(action?.elementType || "");

  let fieldsHtml = "";
  let title = "Add Element";
  if (elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
    title = "Image Block";
    const width = clampNumber(values.imageWidth, 220, 560, 520);
    fieldsHtml = `
      <div class="grid">
        <div class="row">
          <label>Image URL</label>
          <input type="url" data-element-action-k="imageUrl" value="${escAttr(values.imageUrl || "")}" placeholder="https://example.com/image.jpg">
        </div>
        <div class="row">
          <label>Image alt (optional)</label>
          <input type="text" data-element-action-k="imageAlt" value="${escAttr(values.imageAlt || "")}" placeholder="Describe the image">
        </div>
      </div>
      <div class="row">
        <label>Image link URL (optional)</label>
        <input type="url" data-element-action-k="imageLinkUrl" value="${escAttr(values.imageLinkUrl || "")}" placeholder="https://example.com">
      </div>
      <div class="row">
        <label>Image width: <span data-element-action-image-width-value>${width}px</span></label>
        <input type="range" min="220" max="560" step="10" data-element-action-k="imageWidth" value="${width}">
      </div>
    `;
  } else if (elementType === ELEMENT_LIBRARY_ITEM_CTA) {
    title = "CTA Button";
    fieldsHtml = `
      <div class="grid">
        <div class="row">
          <label>Button text</label>
          <input type="text" data-element-action-k="ctaText" value="${escAttr(values.ctaText || "")}" placeholder="e.g. Learn more">
        </div>
        <div class="row">
          <label>Button URL</label>
          <input type="url" data-element-action-k="ctaUrl" value="${escAttr(values.ctaUrl || "")}" placeholder="https://example.com">
        </div>
      </div>
    `;
  } else if (elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
    title = "Markdown Fragment";
    fieldsHtml = `
      <div class="row">
        <label>Markdown</label>
        <textarea data-element-action-k="markdown" placeholder="# Heading&#10;Body copy with **bold**, lists, and [links](https://example.com).">${escHtml(values.markdown || "")}</textarea>
      </div>
    `;
  } else if (elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
    title = "HTML Fragment";
    fieldsHtml = `
      <div class="row">
        <label>HTML fragment</label>
        <textarea data-element-action-k="htmlFragment" placeholder="<div style=&quot;padding:16px; border:1px solid #e5e7eb;&quot;>Snippet</div>">${escHtml(values.htmlFragment || "")}</textarea>
        <div class="small" style="margin-top:6px;">Script tags are removed automatically for safety.</div>
      </div>
    `;
  }

  return `
    <label style="margin-bottom:6px;">${title} Tray</label>
    <div class="small" style="margin-bottom:10px;">Target: ${targetLabel}</div>
    ${fieldsHtml}
    <div class="btns">
      <button class="secondary" type="button" data-element-action-cancel>Cancel</button>
      <button type="button" data-element-action-apply>Apply</button>
    </div>
  `;
}

function applyPendingElementAction() {
  const editor = ensurePreviewEditorState();
  const action = normalizePendingElementAction(editor.pendingElementAction);
  if (!action) return false;

  const values = action.values || {};
  if (action.elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
    const imageUrl = normalizeImageUrl(values.imageUrl);
    if (!imageUrl) {
      window.alert("Image URL is required.");
      return false;
    }
  } else if (action.elementType === ELEMENT_LIBRARY_ITEM_CTA) {
    const ctaText = String(values.ctaText || "").trim();
    const ctaUrl = normalizeCtaUrl(values.ctaUrl);
    if (!ctaText || !ctaUrl) {
      window.alert("CTA text and URL are required.");
      return false;
    }
  }

  let changed = false;
  let nextActiveSectionId = String(action.targetSectionId || "");

  if (action.targetSectionId) {
    if (action.elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
      changed = addImageForSection(action.targetSectionId, values);
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_CTA) {
      changed = addCtaLinkForSection(action.targetSectionId, values);
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
      changed = addMarkdownFragmentForSection(action.targetSectionId, values.markdown);
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
      changed = addHtmlFragmentForSection(action.targetSectionId, values.htmlFragment);
    }
  } else {
    const targetEnabledIndex = Number.isFinite(action.targetEnabledIndex)
      ? action.targetEnabledIndex
      : state.sections.filter(section => section.enabled).length;
    let initialValues = {};
    if (action.elementType === ELEMENT_LIBRARY_ITEM_IMAGE) {
      initialValues = {
        imageUrl: normalizeImageUrl(values.imageUrl),
        imageAlt: String(values.imageAlt || ""),
        imageLinkUrl: normalizeImageUrl(values.imageLinkUrl),
        imageWidth: clampNumber(values.imageWidth, 220, 560, 520)
      };
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_CTA) {
      initialValues = {
        ctaText: String(values.ctaText || "").trim(),
        ctaUrl: normalizeCtaUrl(values.ctaUrl)
      };
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) {
      initialValues = { markdown: String(values.markdown || "") };
    } else if (action.elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) {
      initialValues = { htmlFragment: String(values.htmlFragment || "") };
    }

    const insertedSectionId = createBlankMarkdownSectionAtIndex(targetEnabledIndex, initialValues);
    changed = !!insertedSectionId;
    nextActiveSectionId = insertedSectionId;
    if (changed) {
      renderMarkdownSectionsUI();
      renderHtmlFragmentsUI();
      renderSectionsUI();
      generateHtml();
    }
  }

  if (!changed) return false;
  clearPendingElementAction({ save: false });
  if (nextActiveSectionId) setActivePreviewSection(nextActiveSectionId, { save: false });
  saveState();
  applyPreviewSectionTrayUI();
  return true;
}

function bindPendingElementActionTray(tray, action) {
  if (!tray || !action) return;

  const syncImageWidthLabel = () => {
    const range = tray.querySelector('[data-element-action-k="imageWidth"]');
    const output = tray.querySelector("[data-element-action-image-width-value]");
    if (!range || !output) return;
    output.textContent = `${range.value}px`;
  };

  tray.querySelectorAll("input[data-element-action-k], textarea[data-element-action-k], select[data-element-action-k]").forEach(field => {
    field.addEventListener("input", () => {
      const key = String(field.dataset.elementActionK || "");
      if (!key) return;
      if (!action.values || typeof action.values !== "object") action.values = {};
      if (key === "imageWidth") {
        action.values[key] = clampNumber(field.value, 220, 560, 520);
        field.value = String(action.values[key]);
        syncImageWidthLabel();
      } else {
        action.values[key] = field.value;
      }
    });
  });

  const applyBtn = tray.querySelector("[data-element-action-apply]");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyPendingElementAction();
    });
  }

  const cancelBtn = tray.querySelector("[data-element-action-cancel]");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      clearPendingElementAction();
    });
  }

  syncImageWidthLabel();
}

function applyPreviewSectionTrayUI() {
  const panel = document.getElementById("editorPanel");
  if (!panel) return;

  const editor = ensurePreviewEditorState();
  const editMode = !!editor.enabled;
  const blockById = new Map(
    Array.from(panel.querySelectorAll("details[data-section-id]"))
      .map(block => [String(block.dataset.sectionId || ""), block])
  );
  const enabledSectionIds = new Set(
    state.sections
      .filter(section => section.enabled)
      .map(section => String(section.id || ""))
  );

  let activeSectionId = String(editor.activeSectionId || "");
  if (!activeSectionId || !enabledSectionIds.has(activeSectionId) || !blockById.has(activeSectionId)) {
    activeSectionId = "";
    editor.activeSectionId = "";
  }

  const emptyState = ensurePreviewSectionTrayEmptyState(panel);
  const actionTray = ensurePreviewElementActionTray(panel);
  const pendingAction = editor.pendingElementAction;
  panel.classList.toggle("preview-section-tray-mode", editMode);

  Array.from(panel.children).forEach(child => {
    if (child.matches("h2")) {
      child.hidden = false;
      return;
    }
    if (child.matches("details[data-section-id]")) return;
    if (child === emptyState) return;
    if (child === actionTray) return;
    child.hidden = editMode;
  });

  if (actionTray) {
    const showActionTray = !!(editMode && pendingAction);
    actionTray.hidden = !showActionTray;
    if (showActionTray) {
      actionTray.innerHTML = buildPendingElementActionTrayHtml(pendingAction);
      bindPendingElementActionTray(actionTray, pendingAction);
      actionTray.querySelectorAll("textarea").forEach(bindAutoResizeTextarea);
    }
  }

  blockById.forEach((block, sectionId) => {
    if (!editMode) {
      block.hidden = !enabledSectionIds.has(sectionId);
      return;
    }
    const visible = !!activeSectionId && sectionId === activeSectionId;
    block.hidden = !visible;
    if (visible) block.open = true;
  });

  if (emptyState) {
    emptyState.hidden = !(editMode && !activeSectionId && !pendingAction);
  }
}

function setActivePreviewSection(sectionId, options = {}) {
  const opts = {
    save: true,
    ...options
  };
  const editor = ensurePreviewEditorState();
  const nextId = String(sectionId || "").trim();
  if (editor.activeSectionId === nextId) {
    applyPreviewSectionTrayUI();
    return;
  }
  editor.activeSectionId = nextId;
  if (opts.save) saveState();
  applyPreviewSectionTrayUI();
}

function applyPreviewEditModeUI() {
  const enabled = !!ensurePreviewEditorState().enabled;
  document.body.classList.toggle("preview-edit-mode", enabled);

  const modeBtn = document.getElementById("modeToggleBtn");
  if (modeBtn) {
    modeBtn.textContent = enabled ? "Preview" : "Edit";
    modeBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  const modeStatus = document.getElementById("modeStatus");
  if (modeStatus) {
    modeStatus.textContent = enabled ? "Edit mode" : "Preview mode";
  }

  applyPreviewSectionTrayUI();
}

function setPreviewEditMode(enabled) {
  const editor = ensurePreviewEditorState();
  const next = !!enabled;
  if (editor.enabled === next) {
    applyPreviewEditModeUI();
    return;
  }
  editor.enabled = next;
  if (next) {
    editor.activeSectionId = "";
  } else {
    editor.pendingElementAction = null;
  }
  saveState();
  applyPreviewEditModeUI();
  generateHtml();
}

function getSectionEntryWithIndex(sectionId) {
  const idx = state.sections.findIndex(section => section.id === sectionId);
  if (idx < 0) return { section: null, idx: -1 };
  return { section: state.sections[idx], idx };
}

function insertSectionAtEnabledIndex(section, targetEnabledIndex) {
  const enabledSections = state.sections.filter(s => s.enabled);
  const maxIndex = enabledSections.length;
  const raw = Number(targetEnabledIndex);
  const normalized = Number.isFinite(raw) ? Math.round(raw) : 0;
  const clamped = Math.max(0, Math.min(normalized, maxIndex));

  if (enabledSections.length === 0) {
    state.sections.unshift(section);
    return;
  }

  if (clamped >= enabledSections.length) {
    const lastEnabled = enabledSections[enabledSections.length - 1];
    const lastEnabledIdx = state.sections.indexOf(lastEnabled);
    state.sections.splice(lastEnabledIdx + 1, 0, section);
    return;
  }

  const beforeEnabled = enabledSections[clamped];
  const beforeIdx = state.sections.indexOf(beforeEnabled);
  state.sections.splice(beforeIdx, 0, section);
}

function moveEnabledSectionToIndex(sectionId, targetEnabledIndex) {
  const { section, idx } = getSectionEntryWithIndex(sectionId);
  if (!section || idx < 0 || !section.enabled) return false;

  const enabledIds = state.sections.filter(s => s.enabled).map(s => s.id);
  const fromEnabledIndex = enabledIds.indexOf(sectionId);
  const rawTarget = Number(targetEnabledIndex);
  const normalizedTarget = Number.isFinite(rawTarget) ? Math.round(rawTarget) : 0;
  let adjustedTarget = Math.max(0, Math.min(normalizedTarget, enabledIds.length));
  if (fromEnabledIndex >= 0 && fromEnabledIndex < adjustedTarget) {
    adjustedTarget -= 1;
  }

  state.sections.splice(idx, 1);
  insertSectionAtEnabledIndex(section, adjustedTarget);
  return true;
}

function insertDisabledSectionAtIndex(sectionId, targetEnabledIndex) {
  const { section, idx } = getSectionEntryWithIndex(sectionId);
  if (!section || idx < 0 || section.enabled) return false;

  state.sections.splice(idx, 1);
  section.enabled = true;
  insertSectionAtEnabledIndex(section, targetEnabledIndex);
  return true;
}

function createBlankMarkdownSectionAtIndex(targetEnabledIndex, initialValues = null) {
  const seed = (initialValues && typeof initialValues === "object") ? initialValues : {};
  const section = {
    ...blankMarkdownSection(),
    ...seed
  };
  section.imageWidth = clampNumber(section.imageWidth, 220, 560, 520);
  state.markdownSections.push(section);

  const markdownIndex = state.markdownSections.length - 1;
  const sectionEntry = {
    id: section.id,
    label: markdownSectionSummary(section, markdownIndex),
    enabled: true
  };
  insertSectionAtEnabledIndex(sectionEntry, targetEnabledIndex);
  return section.id;
}

function createBlankHtmlFragmentAtIndex(targetEnabledIndex) {
  const fragment = blankHtmlFragment();
  state.htmlFragments.push(fragment);

  const fragmentIndex = state.htmlFragments.length - 1;
  const sectionEntry = {
    id: fragment.id,
    label: htmlFragmentSummary(fragment, fragmentIndex),
    enabled: true
  };
  insertSectionAtEnabledIndex(sectionEntry, targetEnabledIndex);
  return fragment.id;
}

function insertLibraryItemAtIndex(itemId, targetEnabledIndex) {
  if (itemId === LIBRARY_ITEM_NEW_MARKDOWN) {
    return createBlankMarkdownSectionAtIndex(targetEnabledIndex);
  }
  if (itemId === LIBRARY_ITEM_NEW_HTML_FRAGMENT) {
    return createBlankHtmlFragmentAtIndex(targetEnabledIndex);
  }
  return insertDisabledSectionAtIndex(itemId, targetEnabledIndex) ? itemId : "";
}

function isSectionEnabled(sectionId) {
  const section = state.sections.find(item => item.id === sectionId);
  return !!section?.enabled;
}

function disableSectionById(sectionId) {
  const { section } = getSectionEntryWithIndex(sectionId);
  if (!section || !section.enabled) return false;
  section.enabled = false;
  return true;
}

function previewDragPayloadFromEvent(event) {
  const payload = String(event?.dataTransfer?.getData("text/plain") || "");
  const [kind, itemId] = payload.split(":");
  if (!itemId) return null;
  if (kind === "existing" || kind === "library") {
    return { kind, sectionId: itemId };
  }
  if (kind === "element") {
    return { kind, elementType: itemId };
  }
  return null;
}

function sectionSupportsInlineCta(sectionId) {
  if (!sectionId) return false;
  return (
    sectionId === "featureSlot" ||
    sectionId === "highlight" ||
    sectionId === "customLinks" ||
    isMarkdownSectionId(sectionId)
  );
}

function normalizeCtaUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeImageUrl(rawUrl) {
  return normalizeOptionalHttpUrl(rawUrl);
}

function sectionSupportsInlineImage(sectionId) {
  if (!sectionId) return false;
  return (
    isMarkdownSectionId(sectionId) ||
    sectionId === "featureSlot"
  );
}

function sectionSupportsElementDrop(sectionId, elementType) {
  if (!sectionId) return false;
  if (elementType === ELEMENT_LIBRARY_ITEM_CTA) return sectionSupportsInlineCta(sectionId);
  if (elementType === ELEMENT_LIBRARY_ITEM_IMAGE) return sectionSupportsInlineImage(sectionId);
  if (elementType === ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT) return isMarkdownSectionId(sectionId);
  if (elementType === ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT) return isMarkdownSectionId(sectionId);
  return false;
}

function getSectionImageDefaults(sectionId) {
  if (isMarkdownSectionId(sectionId)) {
    const section = state.markdownSections.find(item => item.id === sectionId);
    if (!section) return null;
    return {
      imageUrl: String(section.imageUrl || ""),
      imageAlt: String(section.imageAlt || ""),
      imageLinkUrl: String(section.imageLinkUrl || ""),
      imageWidth: clampNumber(section.imageWidth, 220, 560, 520)
    };
  }
  if (sectionId === "featureSlot") {
    return {
      imageUrl: String(document.getElementById("feature_img")?.value || ""),
      imageAlt: String(document.getElementById("feature_alt")?.value || ""),
      imageLinkUrl: String(document.getElementById("feature_img_link")?.value || ""),
      imageWidth: clampNumber(document.getElementById("feature_img_width")?.value, 220, 560, 520)
    };
  }
  return null;
}

function addMarkdownFragmentForSection(sectionId, nextMarkdownInput = "") {
  if (!isMarkdownSectionId(sectionId)) return false;
  const section = state.markdownSections.find(item => item.id === sectionId);
  if (!section) return false;

  const nextMarkdown = String(nextMarkdownInput || "").trim();

  section.markdown = nextMarkdown;
  renderMarkdownSectionsUI();
  saveState();
  renderSectionsUI();
  generateHtml();
  return true;
}

function addHtmlFragmentForSection(sectionId, nextHtmlInput = "") {
  if (!isMarkdownSectionId(sectionId)) return false;
  const section = state.markdownSections.find(item => item.id === sectionId);
  if (!section) return false;

  const nextHtml = String(nextHtmlInput || "").trim();

  section.htmlFragment = nextHtml;
  renderMarkdownSectionsUI();
  saveState();
  renderSectionsUI();
  generateHtml();
  return true;
}

function addImageForSection(sectionId, providedValues = null) {
  if (!sectionSupportsInlineImage(sectionId)) return false;
  if (!providedValues || typeof providedValues !== "object") return false;
  const values = {
    imageUrl: normalizeImageUrl(providedValues.imageUrl),
    imageAlt: String(providedValues.imageAlt || "").trim(),
    imageLinkUrl: normalizeImageUrl(providedValues.imageLinkUrl),
    imageWidth: clampNumber(providedValues.imageWidth, 220, 560, 520)
  };

  let changed = false;
  if (isMarkdownSectionId(sectionId)) {
    const section = state.markdownSections.find(item => item.id === sectionId);
    if (!section) return false;
    section.imageUrl = values.imageUrl;
    section.imageAlt = values.imageAlt;
    section.imageLinkUrl = values.imageLinkUrl;
    section.imageWidth = values.imageWidth;
    renderMarkdownSectionsUI();
    changed = true;
  } else if (sectionId === "featureSlot") {
    const featureImg = document.getElementById("feature_img");
    const featureAlt = document.getElementById("feature_alt");
    const featureImgLink = document.getElementById("feature_img_link");
    const featureImgWidth = document.getElementById("feature_img_width");
    if (!featureImg || !featureAlt || !featureImgLink || !featureImgWidth) return false;
    featureImg.value = values.imageUrl;
    featureAlt.value = values.imageAlt;
    featureImgLink.value = values.imageLinkUrl;
    featureImgWidth.value = String(clampNumber(values.imageWidth, 220, 520, 520));
    syncFeatureImageWidthValue();
    changed = true;
  }

  if (!changed) return false;
  saveState();
  renderSectionsUI();
  generateHtml();
  return true;
}

function addCtaLinkForSection(sectionId, providedValues = null) {
  if (!sectionSupportsInlineCta(sectionId)) return false;
  if (!providedValues || typeof providedValues !== "object") return false;
  const values = {
    ctaText: String(providedValues.ctaText || "").trim(),
    ctaUrl: normalizeCtaUrl(providedValues.ctaUrl)
  };

  const { ctaText, ctaUrl } = values;
  let changed = false;

  if (sectionId === "featureSlot") {
    const cta1Text = document.getElementById("feature_cta_text_1");
    const cta1Url = document.getElementById("feature_cta_url_1");
    const cta2Text = document.getElementById("feature_cta_text_2");
    const cta2Url = document.getElementById("feature_cta_url_2");
    if (!cta1Text || !cta1Url || !cta2Text || !cta2Url) return false;

    if (!String(cta1Url.value || "").trim()) {
      cta1Text.value = ctaText;
      cta1Url.value = ctaUrl;
      changed = true;
    } else if (!String(cta2Url.value || "").trim()) {
      cta2Text.value = ctaText;
      cta2Url.value = ctaUrl;
      changed = true;
    } else {
      cta2Text.value = ctaText;
      cta2Url.value = ctaUrl;
      changed = true;
    }
  } else if (sectionId === "highlight") {
    const buttonInput = document.getElementById("highlight_button");
    const urlInput = document.getElementById("highlight_url");
    if (!buttonInput || !urlInput) return false;

    buttonInput.value = ctaText;
    urlInput.value = ctaUrl;
    changed = true;
  } else if (sectionId === "customLinks") {
    state.customLinks.push({ prompt: "", linkText: ctaText, url: ctaUrl });
    saveState();
    renderCustomLinksUI();
    changed = true;
  } else if (isMarkdownSectionId(sectionId)) {
    const section = state.markdownSections.find(item => item.id === sectionId);
    if (!section) return false;

    section.ctaText = ctaText;
    section.ctaUrl = ctaUrl;
    saveState();
    renderMarkdownSectionsUI();
    changed = true;
  }

  if (!changed) return false;
  saveState();
  renderSectionsUI();
  generateHtml();
  return true;
}

function normalizeOptionalHttpUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function promptForHighlightAuthorValues() {
  const usernameInput = document.getElementById("highlight_username");
  const avatarInput = document.getElementById("highlight_avatar");
  const moodSelect = document.getElementById("highlight_mood");
  if (!usernameInput || !avatarInput || !moodSelect) return null;

  const nextName = window.prompt("User name", String(usernameInput.value || "").trim());
  if (nextName === null) return null;

  const nextAvatar = window.prompt(
    "Avatar URL (optional; leave blank to remove)",
    String(avatarInput.value || "").trim()
  );
  if (nextAvatar === null) return null;

  const moods = Array.isArray(presets?.moods) ? presets.moods : [];
  const moodList = moods.map(m => `${m.id} (${m.label || m.id})`).join(", ");
  const nextMoodRaw = window.prompt(
    `Mood preset id (blank for none)\n${moodList}`,
    String(moodSelect.value || "none")
  );
  if (nextMoodRaw === null) return null;

  const moodId = String(nextMoodRaw || "").trim() || "none";
  const moodExists = moods.some(m => m.id === moodId);
  if (!moodExists) {
    window.alert(`Mood preset "${moodId}" not found.`);
    return null;
  }

  return {
    username: String(nextName || "").trim(),
    avatar: normalizeOptionalHttpUrl(nextAvatar),
    moodId
  };
}

function addHighlightAuthorMetaFromPreview() {
  const values = promptForHighlightAuthorValues();
  if (!values) return false;

  const usernameInput = document.getElementById("highlight_username");
  const avatarInput = document.getElementById("highlight_avatar");
  const avatarAltInput = document.getElementById("highlight_avatar_alt");
  const moodSelect = document.getElementById("highlight_mood");
  if (!usernameInput || !avatarInput || !moodSelect) return false;

  usernameInput.value = values.username;
  avatarInput.value = values.avatar;
  if (avatarAltInput && values.avatar && !String(avatarAltInput.value || "").trim()) {
    avatarAltInput.value = "User Avatar";
  }
  moodSelect.value = values.moodId;

  saveState();
  renderSectionsUI();
  generateHtml();
  return true;
}

 function sectionStatus(id) {
  const sec = state.sections.find(s => s.id === id);
  if (!sec || !sec.enabled) return "disabled";

  switch (id) {
    case "highlight":
      return allFilled([
        highlight_title,
        highlight_url,
        highlight_username,
        highlight_summary
      ], ["highlight_avatar", "highlight_avatar_alt", "highlight_mood", "highlight_label", "highlight_button"]) ? "ready" : "needs";

    case "featureSlot":
      return featureSlotReady() ? "ready" : "needs";

    case "inThisNewsletter":
      return allFilled([in_this_newsletter_markdown]) ? "ready" : "needs";

    case "podcasts":
      return state.podcasts.every(p =>
        p.title && (p.yt || p.sp)
      ) ? "ready" : "needs";

    case "admissionsBlog":
      return allFilled([blog_desc]) ? "ready" : "needs";

    case "discussion":
      return state.discussion.every(p =>
        p.title && p.url && p.username && p.when
      ) ? "ready" : "needs";

    case "liveClasses":
      return state.classes.every(c =>
        c.time && c.date && c.title && c.url
      ) ? "ready" : "needs";

    case "customLinks":
      return state.customLinks.every(l =>
        l.prompt && l.linkText && l.url
      ) ? "ready" : "needs";

    default: {
      if (isMarkdownSectionId(id)) {
        const section = state.markdownSections.find(s => s.id === id);
        if (!section) return "needs";
        const hasMarkdown = String(section.markdown || "").trim().length > 0;
        const hasHtmlFragment = String(section.htmlFragment || "").trim().length > 0;
        const hasImage = String(section.imageUrl || "").trim().length > 0;
        const hasCta = (
          String(section.ctaText || "").trim().length > 0 &&
          String(section.ctaUrl || "").trim().length > 0
        );
        return (hasMarkdown || hasHtmlFragment || hasImage || hasCta) ? "ready" : "needs";
      }
      if (isHtmlFragmentId(id)) {
        const fragment = state.htmlFragments.find(s => s.id === id);
        if (!fragment) return "needs";
        return String(fragment.html || "").trim().length > 0 ? "ready" : "needs";
      }
      return "needs";
    }
  }
}

function allFilled(requiredEls, optionalIds = []) {
  return requiredEls.every(el => {
    if (!el) return false;
    if (optionalIds.includes(el.id)) return true;
    return String(el.value || "").trim().length > 0;
  });
}

function featureSlotReady() {
  const coreReady = allFilled([
    feature_top_text,
    feature_img,
    feature_bottom_text
  ], ["feature_alt"]);

  if (!coreReady) return false;

  const cta1Text = String(feature_cta_text_1?.value || "").trim();
  const cta1Url = String(feature_cta_url_1?.value || "").trim();
  const cta2Text = String(feature_cta_text_2?.value || "").trim();
  const cta2Url = String(feature_cta_url_2?.value || "").trim();
  const cta2DefaultOnly = cta2Text.toLowerCase() === "try it now" && !cta2Url;

  const cta1Valid = (!!cta1Text && !!cta1Url);
  const cta2Valid = (!!cta2Text && !!cta2Url);
  const cta1Partial = (!!cta1Text && !cta1Url) || (!cta1Text && !!cta1Url);
  const cta2Partial = cta2DefaultOnly ? false : ((!!cta2Text && !cta2Url) || (!cta2Text && !!cta2Url));

  if (cta1Partial || cta2Partial) return false;
  return cta1Valid || cta2Valid;
}
 function renderSectionStatusPill(sectionId) {
  const status = sectionStatus(sectionId);

  if (status === "ready") {
    return `<span class="status-pill ready">✓ Ready</span>`;
  }
  if (status === "disabled") {
    return `<span class="status-pill disabled">⏸ Off</span>`;
  }
  return `<span class="status-pill needs">⚠ Needs info</span>`;
}

/** ------------------------ sections UI ------------------------ **/
function sectionDisplayLabel(section, sectionIndex) {
  if (!section) return "";
  if (isMarkdownSectionId(section.id)) {
    const markdownIndex = state.markdownSections.findIndex(x => x.id === section.id);
    const fallbackIndex = markdownIndex >= 0 ? markdownIndex : sectionIndex;
    const label = String(section.label || "").trim();
    return label || markdownSectionFallbackLabel(fallbackIndex);
  }
  if (isHtmlFragmentId(section.id)) {
    const fragmentIndex = state.htmlFragments.findIndex(x => x.id === section.id);
    const fallbackIndex = fragmentIndex >= 0 ? fragmentIndex : sectionIndex;
    const label = String(section.label || "").trim();
    return label || htmlFragmentFallbackLabel(fallbackIndex);
  }
  return String(section.label || section.id || "").trim();
}

function renderSectionManager() {
  const select = document.getElementById("addSectionSelect");
  const addBtn = document.getElementById("addSectionBtn");
  const empty = document.getElementById("addSectionEmpty");
  if (!select || !addBtn || !empty) return;

  const disabled = state.sections
    .map((section, idx) => ({ section, idx }))
    .filter(({ section }) => !section.enabled);

  select.innerHTML = disabled
    .map(({ section, idx }) =>
      `<option value="${escAttr(section.id)}">${escHtml(sectionDisplayLabel(section, idx))}</option>`
    )
    .join("");

  const hasDisabled = disabled.length > 0;
  select.disabled = !hasDisabled;
  addBtn.disabled = !hasDisabled;
  empty.hidden = hasDisabled;
}

function renderSectionsUI(){
  const blocks = Array.from(document.querySelectorAll("details[data-section-id]"));
  if (!blocks.length) return;

  const blockById = new Map(blocks.map(el => [el.dataset.sectionId, el]));
  const panel = blocks[0].parentElement;
  const insertBefore = document.getElementById("unsubscribe_url")?.closest(".row") || null;

  // Reorder the form blocks so they mirror the generated HTML order.
  state.sections.forEach(s => {
    const block = blockById.get(s.id);
    if (!block || !panel) return;
    panel.insertBefore(block, insertBefore);
  });

  state.sections.forEach((s, idx) => {
    const block = blockById.get(s.id);
    if (!block) return;

    let controls = block.querySelector("[data-inline-section-controls]");
    if (!controls) {
      controls = document.createElement("div");
      controls.setAttribute("data-inline-section-controls", s.id);
      controls.style.marginTop = "10px";
      const summary = block.querySelector("summary");
      block.insertBefore(controls, summary ? summary.nextSibling : block.firstChild);
    } else {
      controls.setAttribute("data-inline-section-controls", s.id);
    }

    controls.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
        <label style="display:inline-flex; align-items:center; gap:8px; font-weight:700; font-size:12px; color:#344054;">
          ${renderSectionStatusPill(s.id)}
          <button class="secondary tiny" type="button" data-remove-inline="${s.id}">Remove</button>
        </label>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button class="secondary tiny" type="button" data-up-inline="${idx}">↑</button>
          <button class="secondary tiny" type="button" data-down-inline="${idx}">↓</button>
        </div>
      </div>
    `;

    block.hidden = !s.enabled;
    block.style.opacity = "1";
  });

  // Clean up orphaned controls if a block exists but is not in state.sections.
  blocks.forEach(block => {
    if (state.sections.some(s => s.id === block.dataset.sectionId)) return;
    const controls = block.querySelector("[data-inline-section-controls]");
    if (controls) controls.remove();
    block.style.opacity = "1";
    block.hidden = false;
  });

  document.querySelectorAll("[data-remove-inline]").forEach(btn => {
    btn.addEventListener("click", () => {
      const s = state.sections.find(x => x.id === btn.dataset.removeInline);
      if (!s) return;
      s.enabled = false;
      saveState();
      renderSectionsUI();
      generateHtml();
    });
  });

  document.querySelectorAll("[data-up-inline]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.upInline);
      if (i <= 0) return;
      const a = state.sections;
      [a[i - 1], a[i]] = [a[i], a[i - 1]];
      saveState();
      renderSectionsUI();
      generateHtml();
    });
  });

  document.querySelectorAll("[data-down-inline]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.downInline);
      const a = state.sections;
      if (i >= a.length - 1) return;
      [a[i + 1], a[i]] = [a[i], a[i + 1]];
      saveState();
      renderSectionsUI();
      generateHtml();
    });
  });

  renderSectionManager();
  applyPreviewSectionTrayUI();
}

const addSectionBtn = document.getElementById("addSectionBtn");
if (addSectionBtn) {
  addSectionBtn.addEventListener("click", () => {
    const select = document.getElementById("addSectionSelect");
    const sectionId = String(select?.value || "");
    if (!sectionId) return;

    const section = state.sections.find(s => s.id === sectionId);
    if (!section) return;

    section.enabled = true;
    if (ensurePreviewEditorState().enabled) {
      setActivePreviewSection(sectionId, { save: false });
    }
    saveState();
    renderSectionsUI();
    generateHtml();

    const block = document.querySelector(`details[data-section-id="${sectionId}"]`);
    if (block) block.open = true;
  });
}

/** ------------------------ low-code admin renderers ------------------------ **/
function renderAdminMoods(){
  const root = document.getElementById("moodsAdmin");
  root.innerHTML = "";
  presets.moods.forEach((m, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>${escHtml(m.id)}</strong>
        <div class="actions">
          <span class="pill" style="background:${escAttr(m.bg)}; color:${escAttr(m.text)};">${escHtml(m.label)}</span>
          <button class="danger tiny" type="button" data-del-mood="${idx}">Remove</button>
        </div>
      </div>
      <div class="grid">
        <div class="row"><label>Label</label><input data-mood-k="label" data-i="${idx}" value="${escAttr(m.label)}"></div>
        <div class="row"><label>ID</label><input data-mood-k="id" data-i="${idx}" value="${escAttr(m.id)}"></div>
      </div>
      <div class="grid">
        <div class="row"><label>BG</label><input data-mood-k="bg" data-i="${idx}" value="${escAttr(m.bg)}"></div>
        <div class="row"><label>Text</label><input data-mood-k="text" data-i="${idx}" value="${escAttr(m.text)}"></div>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input[data-mood-k]").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      presets.moods[i][inp.dataset.moodK] = inp.value;
    });
  });
  root.querySelectorAll("[data-del-mood]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.delMood);
      presets.moods.splice(i, 1);
      renderAdminMoods();
      renderHighlightMoodOptions();
      renderDiscussionUI();
    });
  });
}

function renderAdminTopics(){
  const root = document.getElementById("topicsAdmin");
  root.innerHTML = "";
  presets.topics.forEach((t, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>${escHtml(t.id)}</strong>
        <div class="actions">
          <span class="pill">${escHtml(t.label)}</span>
          <button class="danger tiny" type="button" data-del-topic="${idx}">Remove</button>
        </div>
      </div>
      <div class="grid">
        <div class="row"><label>Label</label><input data-topic-k="label" data-i="${idx}" value="${escAttr(t.label)}"></div>
        <div class="row"><label>ID</label><input data-topic-k="id" data-i="${idx}" value="${escAttr(t.id)}"></div>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input[data-topic-k]").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      presets.topics[i][inp.dataset.topicK] = inp.value;
    });
  });
  root.querySelectorAll("[data-del-topic]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.delTopic);
      presets.topics.splice(i, 1);
      renderAdminTopics();
      renderDiscussionUI();
    });
  });
}

function renderAdminInstructors(){
  const root = document.getElementById("instructorsAdmin");
  root.innerHTML = "";
  presets.instructors.forEach((ins, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>${escHtml(ins.id)}</strong>
        <div class="actions">
          ${ins.avatar ? `<img src="${escAttr(ins.avatar)}" width="24" height="24" style="border-radius:999px; border:1px solid #e5e7eb;" alt="">` : ""}
          <span class="pill">${escHtml(ins.name)}</span>
          <button class="danger tiny" type="button" data-del-ins="${idx}">Remove</button>
        </div>
      </div>
      <div class="grid">
        <div class="row"><label>Name</label><input data-ins-k="name" data-i="${idx}" value="${escAttr(ins.name)}"></div>
        <div class="row"><label>ID</label><input data-ins-k="id" data-i="${idx}" value="${escAttr(ins.id)}"></div>
      </div>
      <div class="row"><label>Avatar URL</label><input data-ins-k="avatar" data-i="${idx}" value="${escAttr(ins.avatar)}"></div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input[data-ins-k]").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      presets.instructors[i][inp.dataset.insK] = inp.value;
    });
  });
  root.querySelectorAll("[data-del-ins]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.delIns);
      presets.instructors.splice(i, 1);
      renderAdminInstructors();
      renderClassesUI();
    });
  });
}

function renderAdminDifficulties(){
  const root = document.getElementById("difficultiesAdmin");
  root.innerHTML = "";
  presets.difficulties.forEach((d, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>${escHtml(d.id)}</strong>
        <div class="actions">
          <span class="pill">${escHtml(d.label)}</span>
          <button class="danger tiny" type="button" data-del-diff="${idx}">Remove</button>
        </div>
      </div>
      <div class="grid">
        <div class="row"><label>Label</label><input data-diff-k="label" data-i="${idx}" value="${escAttr(d.label)}"></div>
        <div class="row"><label>ID</label><input data-diff-k="id" data-i="${idx}" value="${escAttr(d.id)}"></div>
      </div>
      <div class="grid">
        <div class="row"><label>Filled count (1–3)</label><input data-diff-k="filledCount" data-i="${idx}" value="${escAttr(d.filledCount)}"></div>
        <div class="row"><label>Filled color</label><input data-diff-k="filled" data-i="${idx}" value="${escAttr(d.filled)}"></div>
      </div>
      <div class="row"><label>Empty color</label><input data-diff-k="empty" data-i="${idx}" value="${escAttr(d.empty)}"></div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input[data-diff-k]").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.diffK;
      presets.difficulties[i][k] = (k === "filledCount") ? Number(inp.value) : inp.value;
    });
  });
  root.querySelectorAll("[data-del-diff]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.delDiff);
      presets.difficulties.splice(i, 1);
      renderAdminDifficulties();
      renderClassesUI();
    });
  });
}

function renderAdminAll(){
  renderAdminMoods();
  renderAdminTopics();
  renderAdminInstructors();
  renderAdminDifficulties();
}

document.getElementById("addMoodBtn").addEventListener("click", () => {
  presets.moods.push({ id: "mood_" + (presets.moods.length+1), label:"", bg:"#ffffff", text:"#344054" });
  renderAdminMoods();
  renderHighlightMoodOptions();
});
document.getElementById("addTopicBtn").addEventListener("click", () => {
  presets.topics.push({ id: "topic_" + (presets.topics.length+1), label:"" });
  renderAdminTopics();
});
document.getElementById("addInstructorBtn").addEventListener("click", () => {
  presets.instructors.push({ id: "instructor_" + (presets.instructors.length+1), name:"", avatar:"" });
  renderAdminInstructors();
});
document.getElementById("addDifficultyBtn").addEventListener("click", () => {
  presets.difficulties.push({ id: "difficulty_" + (presets.difficulties.length+1), label:"", filledCount:1, filled:"#2a6c7f", empty:"#e5eef2" });
  renderAdminDifficulties();
});

document.getElementById("savePresetsBtn").addEventListener("click", () => {
  // sanitize IDs if blank
  presets.moods.forEach(m => { if (!m.id.trim()) m.id = slugify(m.label || "mood"); });
  presets.topics.forEach(t => { if (!t.id.trim()) t.id = slugify(t.label || "topic"); });
  presets.instructors.forEach(i => { if (!i.id.trim()) i.id = slugify(i.name || "instructor"); });
  presets.difficulties.forEach(d => { if (!d.id.trim()) d.id = slugify(d.label || "difficulty"); });

  // fix dangling references
  state.discussion.forEach(p => {
    if (!byId(presets.moods, p.moodId)) p.moodId = "none";
    if (!byId(presets.topics, p.topicId)) p.topicId = presets.topics[0]?.id || "";
  });
  state.classes.forEach(r => {
    if (!byId(presets.instructors, r.instructorId)) r.instructorId = presets.instructors[0]?.id || "";
    if (!byId(presets.difficulties, r.difficultyId)) r.difficultyId = presets.difficulties[0]?.id || "";
  });

  savePresets();
  alert("Presets saved (local).");

  saveState();
  renderHighlightMoodOptions();
  renderDiscussionUI();
  renderClassesUI();
});

document.getElementById("resetPresetsBtn").addEventListener("click", () => {
  presets = deepClone(DEFAULT_PRESETS);

  // repair any references after reset
  state.discussion.forEach(p => {
    if (!byId(presets.moods, p.moodId)) p.moodId = "none";
    if (!byId(presets.topics, p.topicId)) p.topicId = presets.topics[0]?.id || "";
  });
  state.classes.forEach(r => {
    if (!byId(presets.instructors, r.instructorId)) r.instructorId = presets.instructors[0]?.id || "";
    if (!byId(presets.difficulties, r.difficultyId)) r.difficultyId = presets.difficulties[0]?.id || "basic";
  });

  savePresets();
  saveState();
  renderAdminAll();
  renderHighlightMoodOptions();
  renderDiscussionUI();
  renderClassesUI();
  alert("Presets reset to defaults (local).");
});




/** ------------------------ Discussion UI (manual entry) ------------------------ **/
function blankDiscussionPost(){
  return { avatar:"", topicId: presets.topics[0]?.id || "", when:"", username:"", moodId:"none", title:"", url:"" };
}
function renderDiscussionUI(){
  const root = document.getElementById("discussionList");
  root.innerHTML = "";

  const topicOptions = presets.topics.map(t => `<option value="${escAttr(t.id)}">${escHtml(t.label)}</option>`).join("");
  const moodOptions = presets.moods.map(m => `<option value="${escAttr(m.id)}">${escHtml(m.label)}</option>`).join("");

  state.discussion.forEach((p, idx) => {
    const mood = byId(presets.moods, p.moodId) || byId(presets.moods, "none");
    const topic = byId(presets.topics, p.topicId);

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>Post ${idx+1}</strong>
        <div class="actions">
          ${topic ? `<span class="pill">${escHtml(topic.label)}</span>` : ""}
          ${mood ? `<span class="pill" style="background:${escAttr(mood.bg)}; color:${escAttr(mood.text)};">${escHtml(mood.label)}</span>` : ""}
          <button class="secondary tiny" type="button" data-clear-post="${idx}">Clear</button>
          <button class="danger tiny" type="button" data-remove-post="${idx}">Remove</button>
        </div>
      </div>

      <div class="grid">
        <div class="row">
          <label>Topic</label>
          <select data-k="topicId" data-i="${idx}">
            ${topicOptions}
          </select>
        </div>
        <div class="row">
          <label>Mood</label>
          <select data-k="moodId" data-i="${idx}">
            ${moodOptions}
          </select>
        </div>
      </div>

      <div class="grid">
        <div class="row"><label>Day label</label><input data-k="when" data-i="${idx}" value="${escAttr(p.when)}"></div>
        <div class="row"><label>Username</label><input data-k="username" data-i="${idx}" value="${escAttr(p.username)}"></div>
      </div>

      <div class="grid">
        <div class="row"><label>Avatar URL</label><input data-k="avatar" data-i="${idx}" value="${escAttr(p.avatar)}"></div>
        <div class="row"><label>URL</label><input data-k="url" data-i="${idx}" value="${escAttr(p.url)}" placeholder="https://7sage.com/discussion/..."></div>
      </div>

      <div class="row"><label>Title</label><input data-k="title" data-i="${idx}" value="${escAttr(p.title)}"></div>
    `;
    root.appendChild(el);
    el.querySelector(`select[data-k="topicId"][data-i="${idx}"]`).value = p.topicId || (presets.topics[0]?.id || "");
    el.querySelector(`select[data-k="moodId"][data-i="${idx}"]`).value = p.moodId || "none";
  });

  // Input updates (kept as-is; re-renders to refresh pills)
  root.querySelectorAll("input, select").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      state.discussion[i][k] = inp.value;
      saveState();
      renderDiscussionUI();
    });
  });

  // Clear/remove handlers
  root.querySelectorAll("[data-clear-post]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.clearPost);
      state.discussion[i] = blankDiscussionPost();
      saveState();
      renderDiscussionUI();
    });
  });

  root.querySelectorAll("[data-remove-post]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.removePost);
      state.discussion.splice(i, 1);
      if (state.discussion.length === 0) state.discussion.push(blankDiscussionPost());
      saveState();
      renderDiscussionUI();
    });
  });

}

document.getElementById("addDiscussionBtn").addEventListener("click", () => {
  state.discussion.push(blankDiscussionPost());
  saveState();
  renderDiscussionUI();
});
document.getElementById("clearAllDiscussionBtn").addEventListener("click", () => {
  state.discussion = [blankDiscussionPost()];
  saveState();
  renderDiscussionUI();
});

/** ------------------------ Podcasts UI ------------------------ **/
function blankPodcast(){
  return { quote:"", title:"", img:"", alt:"", yt:"", sp:"" };
}
function renderPodcastsUI(){
  const root = document.getElementById("podcastsList");
  root.innerHTML = "";

  state.podcasts.forEach((p, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>Episode ${idx + 1}</strong>
        <div class="actions">
          <button class="secondary tiny" type="button" data-clear-podcast="${idx}">Clear</button>
          <button class="danger tiny" type="button" data-remove-podcast="${idx}">Remove</button>
        </div>
      </div>
      <div class="row"><label>Quote / kicker</label><input data-k="quote" data-i="${idx}" value="${escAttr(p.quote)}" placeholder="&quot;A quote from this episode&quot;"></div>
      <div class="row"><label>Episode title</label><input data-k="title" data-i="${idx}" value="${escAttr(p.title)}" placeholder="Episode title"></div>
      <div class="grid">
        <div class="row"><label>YouTube URL</label><input data-k="yt" data-i="${idx}" value="${escAttr(p.yt)}" placeholder="https://youtu.be/..."></div>
        <div class="row"><label>Spotify URL</label><input data-k="sp" data-i="${idx}" value="${escAttr(p.sp)}" placeholder="https://open.spotify.com/..."></div>
      </div>
      <div class="grid">
        <div class="row"><label>Thumbnail URL</label><input data-k="img" data-i="${idx}" value="${escAttr(p.img)}" placeholder="https://..."></div>
        <div class="row"><label>Thumbnail alt</label><input data-k="alt" data-i="${idx}" value="${escAttr(p.alt)}"></div>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      state.podcasts[i][k] = inp.value;
      saveState();
      autoGenerateHtml();
    });
  });

  root.querySelectorAll("[data-clear-podcast]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.clearPodcast);
      state.podcasts[i] = blankPodcast();
      saveState();
      renderPodcastsUI();
      autoGenerateHtml();
    });
  });

  root.querySelectorAll("[data-remove-podcast]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.removePodcast);
      state.podcasts.splice(i, 1);
      if (state.podcasts.length === 0) state.podcasts.push(blankPodcast());
      saveState();
      renderPodcastsUI();
      autoGenerateHtml();
    });
  });
}

document.getElementById("addPodcastBtn").addEventListener("click", () => {
  state.podcasts.push(blankPodcast());
  saveState();
  renderPodcastsUI();
  autoGenerateHtml();
});
document.getElementById("clearAllPodcastsBtn").addEventListener("click", () => {
  state.podcasts = [blankPodcast()];
  saveState();
  renderPodcastsUI();
  autoGenerateHtml();
});

/** ------------------------ Classes UI ------------------------ **/
function blankClassRow(){
  return {
    time:"", date:"",
    instructorId: presets.instructors[0]?.id || "",
    title:"", url:"",
    difficultyId: presets.difficulties[0]?.id || "basic"
  };
}
function renderClassesUI(){
  const root = document.getElementById("classesList");
  root.innerHTML = "";

  const instructorOptions = presets.instructors.map(i => `<option value="${escAttr(i.id)}">${escHtml(i.name || i.id)}</option>`).join("");
  const difficultyOptions = presets.difficulties.map(d => `<option value="${escAttr(d.id)}">${escHtml(d.label || d.id)}</option>`).join("");

  state.classes.forEach((c, idx) => {
    const instr = byId(presets.instructors, c.instructorId);
    const diff = byId(presets.difficulties, c.difficultyId);

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>Class ${idx+1}</strong>
        <div class="actions">
          ${instr?.avatar ? `<img src="${escAttr(instr.avatar)}" width="24" height="24" style="border-radius:999px; border:1px solid #e5e7eb;" alt="">` : ""}
          ${diff?.label ? `<span class="pill">${escHtml(diff.label)}</span>` : ""}
          <button class="secondary tiny" type="button" data-clear-class="${idx}">Clear</button>
          <button class="danger tiny" type="button" data-remove-class="${idx}">Remove</button>
        </div>
      </div>

      <div class="grid">
        <div class="row"><label>Time</label><input data-k="time" data-i="${idx}" value="${escAttr(c.time)}"></div>
        <div class="row"><label>Date</label><input data-k="date" data-i="${idx}" value="${escAttr(c.date)}"></div>
      </div>

      <div class="grid">
        <div class="row"><label>Instructor</label>
          <select data-k="instructorId" data-i="${idx}">${instructorOptions}</select>
        </div>
        <div class="row"><label>Difficulty</label>
          <select data-k="difficultyId" data-i="${idx}">${difficultyOptions}</select>
        </div>
      </div>

      <div class="grid">
        <div class="row"><label>Title</label><input data-k="title" data-i="${idx}" value="${escAttr(c.title)}"></div>
        <div class="row"><label>URL</label><input data-k="url" data-i="${idx}" value="${escAttr(c.url)}"></div>
      </div>
    `;
    root.appendChild(el);

    el.querySelector(`select[data-k="instructorId"][data-i="${idx}"]`).value = c.instructorId || (presets.instructors[0]?.id || "");
    el.querySelector(`select[data-k="difficultyId"][data-i="${idx}"]`).value = c.difficultyId || (presets.difficulties[0]?.id || "basic");
  });

  root.querySelectorAll("input, select").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      state.classes[i][k] = inp.value;
      saveState();
    });
  });

  root.querySelectorAll("[data-clear-class]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.clearClass);
      state.classes[i] = blankClassRow();
      saveState();
      renderClassesUI();
    });
  });

  root.querySelectorAll("[data-remove-class]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.removeClass);
      state.classes.splice(i, 1);
      if (state.classes.length === 0) state.classes.push(blankClassRow());
      saveState();
      renderClassesUI();
    });
  });
}

document.getElementById("addClassBtn").addEventListener("click", () => {
  state.classes.push(blankClassRow());
  saveState();
  renderClassesUI();
});
document.getElementById("clearAllClassesBtn").addEventListener("click", () => {
  state.classes = [blankClassRow()];
  saveState();
  renderClassesUI();
});

/** ------------------------ Custom links low-code ------------------------ **/
function blankCustomLink(){ return { prompt:"", linkText:"", url:"" }; }
function renderCustomLinksUI(){
  const root = document.getElementById("customLinksList");
  root.innerHTML = "";

  state.customLinks.forEach((x, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <strong>Link ${idx+1}</strong>
        <div class="actions">
          <button class="secondary tiny" type="button" data-clear-custom="${idx}">Clear</button>
          <button class="danger tiny" type="button" data-remove-custom="${idx}">Remove</button>
        </div>
      </div>

      <div class="row"><label>Prompt text (e.g., “Need help preparing for an interview?”)</label>
        <input data-k="prompt" data-i="${idx}" value="${escAttr(x.prompt)}"></div>

      <div class="grid">
        <div class="row"><label>Link text</label><input data-k="linkText" data-i="${idx}" value="${escAttr(x.linkText)}"></div>
        <div class="row"><label>URL</label><input data-k="url" data-i="${idx}" value="${escAttr(x.url)}"></div>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      state.customLinks[i][k] = inp.value;
      saveState();
    });
  });

  root.querySelectorAll("[data-clear-custom]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.clearCustom);
      state.customLinks[i] = blankCustomLink();
      saveState();
      renderCustomLinksUI();
    });
  });

  root.querySelectorAll("[data-remove-custom]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.removeCustom);
      state.customLinks.splice(i, 1);
      if (state.customLinks.length === 0) state.customLinks.push(blankCustomLink());
      saveState();
      renderCustomLinksUI();
    });
  });
}

document.getElementById("addCustomLinkBtn").addEventListener("click", () => {
  state.customLinks.push(blankCustomLink());
  saveState();
  renderCustomLinksUI();
});
document.getElementById("clearAllCustomLinksBtn").addEventListener("click", () => {
  state.customLinks = [blankCustomLink()];
  saveState();
  renderCustomLinksUI();
});

/** ------------------------ Markdown sections (dynamic) ------------------------ **/
function blankMarkdownSection(){
  return {
    id: `markdownSection_${Math.random().toString(36).slice(2, 10)}`,
    label:"",
    markdown:"",
    htmlFragment:"",
    ctaText:"",
    ctaUrl:"",
    imageUrl:"",
    imageAlt:"",
    imageLinkUrl:"",
    imageWidth:520
  };
}

function markdownSectionSummary(section, index){
  const label = String(section?.label || "").trim();
  return label || markdownSectionFallbackLabel(index);
}

function blankHtmlFragment(){
  return {
    id: `htmlFragment_${Math.random().toString(36).slice(2, 10)}`,
    label:"",
    html:""
  };
}

function htmlFragmentSummary(fragment, index){
  const label = String(fragment?.label || "").trim();
  return label || htmlFragmentFallbackLabel(index);
}

function ensureMarkdownSectionEntry(section, index){
  let entry = state.sections.find(s => s.id === section.id);
  if (!entry) {
    entry = {
      id: section.id,
      label: markdownSectionSummary(section, index),
      enabled: true
    };
    state.sections.push(entry);
  } else {
    entry.label = markdownSectionSummary(section, index);
    if (entry.enabled === undefined) entry.enabled = true;
  }
}

function ensureHtmlFragmentEntry(fragment, index){
  let entry = state.sections.find(s => s.id === fragment.id);
  if (!entry) {
    entry = {
      id: fragment.id,
      label: htmlFragmentSummary(fragment, index),
      enabled: true
    };
    state.sections.push(entry);
  } else {
    entry.label = htmlFragmentSummary(fragment, index);
    if (entry.enabled === undefined) entry.enabled = true;
  }
}

function renderMarkdownSectionsUI(){
  const panel = document.querySelector(".panel.sticky");
  const insertBefore = document.getElementById("unsubscribe_url")?.closest(".row") || null;
  if (!panel || !insertBefore) return;

  const ids = new Set(state.markdownSections.map(s => s.id));
  panel.querySelectorAll("details[data-markdown-section-id]").forEach(block => {
    if (!ids.has(block.dataset.markdownSectionId)) block.remove();
  });

  state.markdownSections.forEach((section, idx) => {
    ensureMarkdownSectionEntry(section, idx);

    let block = panel.querySelector(`details[data-markdown-section-id="${section.id}"]`);
    if (!block) {
      block = document.createElement("details");
      block.className = "row";
      block.open = true;
      block.dataset.section = "markdown-sections";
      block.dataset.sectionId = section.id;
      block.dataset.markdownSectionId = section.id;
      block.innerHTML = `
        <summary></summary>
        <div class="row" style="margin-top:10px;">
          <label>Section label (optional)</label>
          <input data-markdown-k="label" placeholder="e.g. Study Tip">
        </div>
        <div class="row">
          <label>Markdown fragment (optional)</label>
          <textarea data-markdown-k="markdown" placeholder="# Heading&#10;Write your copy here with **bold**, *italics*, lists, and [links](https://example.com)."></textarea>
        </div>
        <div class="row">
          <label>HTML fragment (optional)</label>
          <textarea data-markdown-k="htmlFragment" placeholder="<div style=&quot;padding:16px; border:1px solid #e5e7eb;&quot;>Paste trusted HTML snippet</div>"></textarea>
          <div class="small" style="margin-top:6px;">Injected as HTML. Script tags are removed automatically for safety.</div>
        </div>
        <div class="grid">
          <div class="row">
            <label>Image URL (optional)</label>
            <input data-markdown-k="imageUrl" placeholder="https://example.com/image.jpg">
          </div>
          <div class="row">
            <label>Image alt (optional)</label>
            <input data-markdown-k="imageAlt" placeholder="Describe the image">
          </div>
        </div>
        <div class="row">
          <label>Image link URL (optional)</label>
          <input data-markdown-k="imageLinkUrl" placeholder="https://example.com">
        </div>
        <div class="row">
          <label>Image width (desktop): <span data-markdown-image-width-value>520px</span></label>
          <input data-markdown-k="imageWidth" type="range" min="220" max="560" step="10" value="520">
          <div class="small" style="margin-top:6px;">Auto-scales on mobile.</div>
        </div>
        <div class="grid">
          <div class="row">
            <label>CTA button text (optional)</label>
            <input data-markdown-k="ctaText" placeholder="e.g. Learn more">
          </div>
          <div class="row">
            <label>CTA button link (optional)</label>
            <input data-markdown-k="ctaUrl" placeholder="https://example.com">
          </div>
        </div>
        <div class="btns">
          <button class="danger tiny" type="button" data-remove-markdown-section>Remove section</button>
        </div>
      `;
    }

    const summary = block.querySelector("summary");
    const labelInput = block.querySelector("[data-markdown-k='label']");
    const markdownInput = block.querySelector("[data-markdown-k='markdown']");
    const htmlFragmentInput = block.querySelector("[data-markdown-k='htmlFragment']");
    const imageUrlInput = block.querySelector("[data-markdown-k='imageUrl']");
    const imageAltInput = block.querySelector("[data-markdown-k='imageAlt']");
    const imageLinkUrlInput = block.querySelector("[data-markdown-k='imageLinkUrl']");
    const imageWidthInput = block.querySelector("[data-markdown-k='imageWidth']");
    const imageWidthValue = block.querySelector("[data-markdown-image-width-value]");
    const ctaTextInput = block.querySelector("[data-markdown-k='ctaText']");
    const ctaUrlInput = block.querySelector("[data-markdown-k='ctaUrl']");
    const removeBtn = block.querySelector("[data-remove-markdown-section]");

    summary.textContent = markdownSectionSummary(section, idx);
    labelInput.value = section.label || "";
    markdownInput.value = section.markdown || "";
    htmlFragmentInput.value = section.htmlFragment || "";
    imageUrlInput.value = section.imageUrl || "";
    imageAltInput.value = section.imageAlt || "";
    imageLinkUrlInput.value = section.imageLinkUrl || "";
    imageWidthInput.value = String(clampNumber(section.imageWidth, 220, 560, 520));
    if (imageWidthValue) imageWidthValue.textContent = `${imageWidthInput.value}px`;
    ctaTextInput.value = section.ctaText || "";
    ctaUrlInput.value = section.ctaUrl || "";
    bindAutoResizeTextarea(markdownInput);
    bindAutoResizeTextarea(htmlFragmentInput);

    labelInput.oninput = () => {
      section.label = labelInput.value;
      const sec = state.sections.find(s => s.id === section.id);
      if (sec) sec.label = markdownSectionSummary(section, idx);
      saveState();
      summary.textContent = markdownSectionSummary(section, idx);
      renderSectionManager();
      autoGenerateHtml();
    };

    markdownInput.oninput = () => {
      clearLinkedRichOverridesForInput(markdownInput);
      section.markdown = markdownInput.value;
      ensureMarkdownSectionEntry(section, idx);
      saveState();
      autoGenerateHtml();
    };

    htmlFragmentInput.oninput = () => {
      section.htmlFragment = htmlFragmentInput.value;
      ensureMarkdownSectionEntry(section, idx);
      saveState();
      autoGenerateHtml();
    };

    imageUrlInput.oninput = () => {
      section.imageUrl = imageUrlInput.value;
      saveState();
      autoGenerateHtml();
    };

    imageAltInput.oninput = () => {
      section.imageAlt = imageAltInput.value;
      saveState();
      autoGenerateHtml();
    };

    imageLinkUrlInput.oninput = () => {
      section.imageLinkUrl = imageLinkUrlInput.value;
      saveState();
      autoGenerateHtml();
    };

    imageWidthInput.oninput = () => {
      section.imageWidth = clampNumber(imageWidthInput.value, 220, 560, 520);
      imageWidthInput.value = String(section.imageWidth);
      if (imageWidthValue) imageWidthValue.textContent = `${section.imageWidth}px`;
      saveState();
      autoGenerateHtml();
    };

    ctaTextInput.oninput = () => {
      section.ctaText = ctaTextInput.value;
      saveState();
      autoGenerateHtml();
    };

    ctaUrlInput.oninput = () => {
      section.ctaUrl = ctaUrlInput.value;
      saveState();
      autoGenerateHtml();
    };

    removeBtn.onclick = () => {
      state.markdownSections = state.markdownSections.filter(s => s.id !== section.id);
      state.sections = state.sections.filter(s => s.id !== section.id);
      clearRichOverrideValue(previewMarkdownRichKey(section.id));
      saveState();
      renderMarkdownSectionsUI();
      renderSectionsUI();
      generateHtml();
    };

    panel.insertBefore(block, insertBefore);
  });

  saveState();
}

document.getElementById("addMarkdownSectionBtn").addEventListener("click", () => {
  const section = blankMarkdownSection();
  state.markdownSections.push(section);
  state.sections.push({
    id: section.id,
    label: markdownSectionSummary(section, state.markdownSections.length - 1),
    enabled: true
  });
  saveState();
  renderMarkdownSectionsUI();
  renderSectionsUI();
  generateHtml();
});

document.getElementById("clearAllMarkdownSectionsBtn").addEventListener("click", () => {
  state.markdownSections.forEach(section => {
    clearRichOverrideValue(previewMarkdownRichKey(section.id));
  });
  state.markdownSections = [];
  state.sections = state.sections.filter(s => !isMarkdownSectionId(s.id));
  saveState();
  renderMarkdownSectionsUI();
  renderSectionsUI();
  generateHtml();
});

function renderHtmlFragmentsUI(){
  const panel = document.querySelector(".panel.sticky");
  const insertBefore = document.getElementById("unsubscribe_url")?.closest(".row") || null;
  if (!panel || !insertBefore) return;

  const ids = new Set(state.htmlFragments.map(fragment => fragment.id));
  panel.querySelectorAll("details[data-html-fragment-id]").forEach(block => {
    if (!ids.has(block.dataset.htmlFragmentId)) block.remove();
  });

  state.htmlFragments.forEach((fragment, idx) => {
    ensureHtmlFragmentEntry(fragment, idx);

    let block = panel.querySelector(`details[data-html-fragment-id="${fragment.id}"]`);
    if (!block) {
      block = document.createElement("details");
      block.className = "row";
      block.open = true;
      block.dataset.section = "html-fragments";
      block.dataset.sectionId = fragment.id;
      block.dataset.htmlFragmentId = fragment.id;
      block.innerHTML = `
        <summary></summary>
        <div class="row" style="margin-top:10px;">
          <label>Section label (optional)</label>
          <input data-html-fragment-k="label" placeholder="e.g. Promo card">
        </div>
        <div class="row">
          <label>HTML fragment</label>
          <textarea data-html-fragment-k="html" placeholder="<div style=&quot;padding:16px; border:1px solid #e5e7eb;&quot;>Paste trusted HTML snippet</div>"></textarea>
          <div class="small" style="margin-top:6px;">Injected as HTML. Script tags are removed automatically for safety.</div>
        </div>
        <div class="btns">
          <button class="danger tiny" type="button" data-remove-html-fragment>Remove section</button>
        </div>
      `;
    }

    const summary = block.querySelector("summary");
    const labelInput = block.querySelector("[data-html-fragment-k='label']");
    const htmlInput = block.querySelector("[data-html-fragment-k='html']");
    const removeBtn = block.querySelector("[data-remove-html-fragment]");

    summary.textContent = htmlFragmentSummary(fragment, idx);
    labelInput.value = fragment.label || "";
    htmlInput.value = fragment.html || "";
    bindAutoResizeTextarea(htmlInput);

    labelInput.oninput = () => {
      fragment.label = labelInput.value;
      const sec = state.sections.find(s => s.id === fragment.id);
      if (sec) sec.label = htmlFragmentSummary(fragment, idx);
      saveState();
      summary.textContent = htmlFragmentSummary(fragment, idx);
      renderSectionManager();
      autoGenerateHtml();
    };

    htmlInput.oninput = () => {
      fragment.html = htmlInput.value;
      saveState();
      autoGenerateHtml();
    };

    removeBtn.onclick = () => {
      state.htmlFragments = state.htmlFragments.filter(s => s.id !== fragment.id);
      state.sections = state.sections.filter(s => s.id !== fragment.id);
      saveState();
      renderHtmlFragmentsUI();
      renderSectionsUI();
      generateHtml();
    };

    panel.insertBefore(block, insertBefore);
  });

  saveState();
}

document.getElementById("addHtmlFragmentBtn").addEventListener("click", () => {
  const fragment = blankHtmlFragment();
  state.htmlFragments.push(fragment);
  state.sections.push({
    id: fragment.id,
    label: htmlFragmentSummary(fragment, state.htmlFragments.length - 1),
    enabled: true
  });
  saveState();
  renderHtmlFragmentsUI();
  renderSectionsUI();
  generateHtml();
});

document.getElementById("clearAllHtmlFragmentsBtn").addEventListener("click", () => {
  state.htmlFragments = [];
  state.sections = state.sections.filter(s => !isHtmlFragmentId(s.id));
  saveState();
  renderHtmlFragmentsUI();
  renderSectionsUI();
  generateHtml();
});

/** ------------------------ Clear buttons (single sections) ------------------------ **/
function clearInputs(ids){
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = "";
  });
}
document.getElementById("clearBlogBtn").addEventListener("click", () => {
  clearInputs(["blog_desc"]);
  clearRichOverrideValue("admissionsBlog.body");
  renderSectionsUI();
  autoGenerateHtml();
});
document.getElementById("clearInThisNewsletterBtn").addEventListener("click", () => {
  clearInputs(["in_this_newsletter_markdown"]);
  clearRichOverrideValue("inThisNewsletter.body");
  renderSectionsUI();
  autoGenerateHtml();
});
document.getElementById("clearFeatureBtn").addEventListener("click", () => {
  clearInputs([
    "feature_header",
    "feature_top_text",
    "feature_img",
    "feature_alt",
    "feature_img_link",
    "feature_bottom_text",
    "feature_cta_text_1",
    "feature_cta_url_1",
    "feature_cta_text_2",
    "feature_cta_url_2"
  ]);
  const cta1 = document.getElementById("feature_cta_text_1");
  if (cta1) cta1.value = "Learn more";
  const cta2 = document.getElementById("feature_cta_text_2");
  if (cta2) cta2.value = "try it now";
  const header = document.getElementById("feature_header");
  if (header) header.value = "Feature Slot";
  const imgWidth = document.getElementById("feature_img_width");
  if (imgWidth) imgWidth.value = "520";
  syncFeatureImageWidthValue();
  clearRichOverrideValue("feature.topText");
  clearRichOverrideValue("feature.bottomText");
  renderSectionsUI();
  autoGenerateHtml();
});
document.getElementById("clearHighlightBtn").addEventListener("click", () => {
  clearInputs([
    "highlight_title",
    "highlight_url",
    "highlight_avatar",
    "highlight_avatar_alt",
    "highlight_username",
    "highlight_summary"
  ]);
  const moodSelect = document.getElementById("highlight_mood");
  if (moodSelect) moodSelect.value = "none";
  clearRichOverrideValue("highlight.summary");
  renderSectionsUI();
  autoGenerateHtml();
});


/** ------------------------ email shell + section wrapper ------------------------ **/
function emailShell({ preheader, sectionsHtml, unsubUrl }) {
  const preheaderPad = "&#847; ".repeat(220);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>7Sage Newsletter</title>
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${PREVIEW_FONT_STYLESHEET_HREF}">
<style>
@import url('${PREVIEW_FONT_STYLESHEET_HREF}');
body, table, td, div, p, li, a, span{
  font-family:'Lexend', Helvetica, Arial, sans-serif;
}
@media only screen and (max-width:600px){
  .container{ width:100% !important; max-width:100% !important; }
  .inner{ width:100% !important; max-width:100% !important; }
  .pad{ padding-left:16px !important; padding-right:16px !important; }
  .podcast-col{ display:block !important; width:100% !important; max-width:100% !important; }
  .podcast-copy{ padding-right:0 !important; padding-bottom:12px !important; }
  .podcast-media{ width:100% !important; max-width:100% !important; }
  .podcast-thumb{ width:100% !important; max-width:100% !important; height:auto !important; }
  .podcast-btn-row td{ display:inline-block !important; width:auto !important; }
}
</style>
</head>

<body style="Margin:0; padding:0; background-color:#f1ede9;">
  <div style="display:none; font-size:1px; color:#ffffff; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
    <span>${preheader}</span><span>${preheaderPad}</span>
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1ede9;">
    <tr>
      <td align="center" style="padding:16px 0;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container"
               style="width:600px; background-color:#f1ede9; border-collapse:separate; border-radius:12px; box-shadow:0 2px 8px rgba(16,24,40,0.08);">

          <!-- HEADER -->
          <tr>
            <td align="center" style="background-color:#fefcfa; border-radius:12px 12px 0 0; padding:24px 0">
              <a href="https://7sage.com/" target="_blank" style="text-decoration:none; display:inline-block;">
                <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/Logo%20-%207Sage%20LSAT%20-%20b2r2-1%20(1).png?updatedAt=1765812786613"
                  alt="7Sage" width="240"
                  style="display:block; width:240px; height:auto; border:0; outline:none; text-decoration:none;">
              </a>
            </td>
          </tr>

          ${sectionsHtml}

          <!-- FOOTER -->
<tr>
  <td align="center" style="background-color:#344054; border-radius:0 0 12px 12px; padding:32px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding-top:16px">
      <tr>
        <td align="center" style="font-family:'Fraunces', Georgia, serif; font-size:20px; font-weight:700; color:#ffffff; padding-bottom:8px;">
          The LSAT is hard.
        </td>
      </tr>
      <tr>
        <td align="center" style="font-family:'Fraunces', Georgia, serif; font-size:20px; font-weight:700; color:#ffffff;">
          We'll help you <mark style="padding:2px; color:#344054; background-color:#ffd279">crush it anyway.</mark>
        </td>
      </tr>
    </table>

    <!-- Social icons row -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding-top:16px;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <a href="https://www.youtube.com/c/7sage" target="_blank">
  <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/youtube_icon.png?updatedAt=1765812785920"
       width="48" height="36" alt="YouTube" style="display:block; border:0;">
</a>

        </td>
        <td align="center" style="padding:0 12px;">
          <a href="https://www.tiktok.com/@7sagelsat" target="_blank">
            <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/tiktok_icon.png?updatedAt=1765812785841"
     width="28" height="28"
     alt="TikTok"
     style="display:block; border:0;">


          </a>
        </td>
        <td align="center" style="padding:0 12px;">
          <a href="https://www.instagram.com/7sage/" target="_blank">
            <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/instagram_icon.png?updatedAt=1765812785783"
     width="32" height="32"
     alt="Instagram"
     style="display:block; border:0;">

          </a>
        </td>

        <!-- Divider -->
        <td align="center" style="padding:0 16px;">
          <div style="width:1px; height:40px; background-color:#667085; display:inline-block;"></div>
        </td>

        <!-- Podcasts link -->
        <td align="center" style="padding:0 12px;">
          <a href="https://open.spotify.com/show/1IYx61IAEHDWfq1Q7Xhq5l"
             target="_blank"
             style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; font-weight:700; color:#d0d5dd; text-decoration:none;">
            Podcasts
          </a>
        </td>
      </tr>
    </table>

    <!-- Unsubscribe -->
    <div style="margin-top:20px;">
      <a href="${unsubUrl}" target="_blank"
         style="font-family:'Lexend', Helvetica, Arial, sans-serif;
                font-size:14px; font-weight:600; color:#d0d5dd; text-decoration:none;">
        Unsubscribe
      </a>
    </div>
  </td>
</tr>


        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function sectionWrapper(bg, innerHtml, options = {}){
  const interactive = !!options.interactive;
  const sectionId = String(options.sectionId || "");
  const sectionAttrs = (interactive && sectionId)
    ? ` data-section-block="true" data-section-id="${escAttr(sectionId)}"`
    : "";
  const removeBtn = (interactive && sectionId)
    ? `<button type="button" data-section-remove-btn data-section-id="${escAttr(sectionId)}" title="Remove section" aria-label="Remove section">&times;</button>`
    : "";
  const dragHandle = (interactive && sectionId) ? `
            <tr>
              <td align="left" class="pad" style="padding:0 20px 10px 20px;">
                <span data-section-drag-handle data-section-id="${escAttr(sectionId)}">Drag section</span>
              </td>
            </tr>` : "";

  return `
<tr${sectionAttrs}>
  <td style="padding:0; background-color:${bg};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="background-color:${bg}; border-bottom:1px solid #e5e7eb;">
      <tr>
        <td align="center" class="pad" style="padding:16px 8px 20px 8px; background-color:${bg};">
          <div data-section-shell>
            ${removeBtn}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="inner"
                   style="width:560px; background-color:${bg};">
              ${dragHandle}
              ${innerHtml}
            </table>
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function buildPreviewSectionLibraryHtml() {
  const disabledSections = state.sections
    .map((section, idx) => ({ section, idx }))
    .filter(({ section }) => !section.enabled);

  const chips = [
    `<span data-section-library-item="${escAttr(LIBRARY_ITEM_NEW_MARKDOWN)}" draggable="true">Blank Section</span>`
  ];

  disabledSections.forEach(({ section, idx }) => {
    const label = sectionDisplayLabel(section, idx) || section.id;
    chips.push(`<span data-section-library-item="${escAttr(section.id)}" draggable="true">${escHtml(label)}</span>`);
  });
  const chipsHtml = chips.join("");
  const helperText = disabledSections.length === 0
    ? `<div data-preview-library-empty style="margin-top:8px;">Drag “Blank Section” to add a flexible content block.</div>`
    : "";
  const body = `<div data-preview-library-list>${chipsHtml}</div>${helperText}`;

  return `
<div data-preview-library-box>
  <div data-preview-library-title>Section Blocks (Drag Into The Email)</div>
  ${body}
</div>`;
}

function buildPreviewElementLibraryHtml() {
  const chips = [
    `<span data-element-library-item="${escAttr(ELEMENT_LIBRARY_ITEM_IMAGE)}" draggable="true">Image Block</span>`,
    `<span data-element-library-item="${escAttr(ELEMENT_LIBRARY_ITEM_CTA)}" draggable="true">CTA Button</span>`,
    `<span data-element-library-item="${escAttr(ELEMENT_LIBRARY_ITEM_MARKDOWN_FRAGMENT)}" draggable="true">Markdown Fragment</span>`,
    `<span data-element-library-item="${escAttr(ELEMENT_LIBRARY_ITEM_HTML_FRAGMENT)}" draggable="true">HTML Fragment</span>`
  ];

  return `
<div data-preview-element-box>
  <div data-preview-element-title>Element Blocks</div>
  <div data-preview-element-list>${chips.join("")}</div>
  <div data-preview-element-hint>Drag onto a compatible section to inject content, or drop between sections to create a new blank section prefilled with that element.</div>
</div>`;
}

function buildHighlightAuthorTrayHtml() {
  if (!isSectionEnabled("highlight")) return "";

  const username = escAttr(document.getElementById("highlight_username")?.value || "");
  const avatar = escAttr(document.getElementById("highlight_avatar")?.value || "");
  const currentMoodId = String(document.getElementById("highlight_mood")?.value || "none");
  const moodOptions = (Array.isArray(presets?.moods) ? presets.moods : [])
    .map(mood => `<option value="${escAttr(mood.id)}">${escHtml(mood.label || mood.id)}</option>`)
    .join("");

  return `
<div data-highlight-author-tray>
  <div data-highlight-author-title>Highlight Author</div>
  <div data-highlight-author-row>
    <label>Name</label>
    <input type="text" data-highlight-author-k="username" value="${username}" placeholder="e.g. student_handle">
  </div>
  <div data-highlight-author-row>
    <label>Avatar URL</label>
    <input type="url" data-highlight-author-k="avatar" value="${avatar}" placeholder="https://example.com/avatar.jpg">
  </div>
  <div data-highlight-author-row>
    <label>Mood pill</label>
    <select data-highlight-author-k="mood">${moodOptions}</select>
  </div>
  <div data-highlight-author-actions>
    <button type="button" data-highlight-author-clear>Clear</button>
  </div>
</div>`;
}

function buildDiscussionEditorTrayHtml() {
  const discussionSection = state.sections.find(section => section.id === "discussion");
  if (!discussionSection) return "";
  const discussionHeader = escAttr(document.getElementById("discussion_label")?.value || "");

  if (!Array.isArray(state.discussion) || state.discussion.length === 0) {
    state.discussion = [blankDiscussionPost()];
  }

  if (!discussionSection.enabled) {
    return `
<div data-discussion-tray>
  <div data-discussion-tray-title>Discussion Forum Roundup</div>
  <div data-discussion-tray-row>
    <label>Header label</label>
    <input data-discussion-header value="${discussionHeader}">
  </div>
  <div data-discussion-tray-empty>
    This section is currently removed from the email. Add it back to edit posts.
  </div>
  <div data-discussion-tray-actions>
    <button type="button" data-discussion-tray-enable>Add section</button>
  </div>
</div>`;
  }

  const topicOptions = Array.isArray(presets?.topics) ? presets.topics : [];
  const moodOptions = Array.isArray(presets?.moods) ? presets.moods : [];

  const postsHtml = state.discussion.map((rawPost, idx) => {
    const post = { ...blankDiscussionPost(), ...(rawPost || {}) };
    const topicSelectHtml = topicOptions
      .map(topic => `<option value="${escAttr(topic.id)}"${topic.id === post.topicId ? " selected" : ""}>${escHtml(topic.label || topic.id)}</option>`)
      .join("");
    const moodSelectHtml = moodOptions
      .map(mood => `<option value="${escAttr(mood.id)}"${mood.id === post.moodId ? " selected" : ""}>${escHtml(mood.label || mood.id)}</option>`)
      .join("");

    return `
<div data-discussion-tray-post>
  <div data-discussion-tray-head>
    <strong>Post ${idx + 1}</strong>
    <div style="display:flex; gap:6px;">
      <button type="button" data-discussion-tray-clear-post="${idx}">Clear</button>
      <button type="button" data-discussion-tray-remove="${idx}">Remove</button>
    </div>
  </div>
  <div data-discussion-tray-grid>
    <div data-discussion-tray-row>
      <label>Topic</label>
      <select data-discussion-k="topicId" data-i="${idx}">${topicSelectHtml}</select>
    </div>
    <div data-discussion-tray-row>
      <label>Mood</label>
      <select data-discussion-k="moodId" data-i="${idx}">${moodSelectHtml}</select>
    </div>
  </div>
  <div data-discussion-tray-grid>
    <div data-discussion-tray-row>
      <label>Day label</label>
      <input data-discussion-k="when" data-i="${idx}" value="${escAttr(post.when || "")}">
    </div>
    <div data-discussion-tray-row>
      <label>Username</label>
      <input data-discussion-k="username" data-i="${idx}" value="${escAttr(post.username || "")}">
    </div>
  </div>
  <div data-discussion-tray-grid>
    <div data-discussion-tray-row>
      <label>Avatar URL</label>
      <input data-discussion-k="avatar" data-i="${idx}" value="${escAttr(post.avatar || "")}">
    </div>
    <div data-discussion-tray-row>
      <label>Post URL</label>
      <input data-discussion-k="url" data-i="${idx}" value="${escAttr(post.url || "")}" placeholder="https://7sage.com/discussion/...">
    </div>
  </div>
  <div data-discussion-tray-row>
    <label>Title</label>
    <input data-discussion-k="title" data-i="${idx}" value="${escAttr(post.title || "")}">
  </div>
</div>`;
  }).join("");

  return `
<div data-discussion-tray>
  <div data-discussion-tray-title>Discussion Forum Roundup</div>
  <div data-discussion-tray-row>
    <label>Header label</label>
    <input data-discussion-header value="${discussionHeader}">
  </div>
  ${postsHtml}
  <div data-discussion-tray-actions>
    <button type="button" data-discussion-tray-add>Add post</button>
    <button type="button" data-discussion-tray-clear-all>Clear all</button>
  </div>
</div>`;
}

function buildSectionDropzoneRow(index) {
  return `
<tr data-section-dropzone-index="${Number(index)}">
  <td style="padding:0; background-color:#f1ede9;">
    <div data-section-dropzone></div>
  </td>
</tr>`;
}

/** ------------------------ section builders ------------------------ **/
function buildHighlight(bg, options = {}){
  const interactive = !!options.interactive;
  const sectionLabelInput = String(document.getElementById("highlight_label").value || "").trim();
  const sectionLabel = sectionLabelInput
    ? wrapEditablePlain(escHtml(sectionLabelInput).toUpperCase(), "highlight.label", interactive)
    : "";
  const sectionLabelRow = sectionLabel
    ? `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${sectionLabel}</td></tr>`
    : "";
  const titleValue = document.getElementById("highlight_title").value;
  const title = wrapEditablePlain(
    inlineMarkdownToHtml(titleValue, { allowLinks: false }),
    "highlight.title",
    interactive
  );
  const url = escAttr(document.getElementById("highlight_url").value);
  const avatar = escAttr(document.getElementById("highlight_avatar").value);
  const avatarAlt = escAttr(document.getElementById("highlight_avatar_alt").value || "User Avatar");
  const username = wrapEditablePlain(
    escHtml(document.getElementById("highlight_username").value),
    "highlight.username",
    interactive
  );
  const moodId = String(document.getElementById("highlight_mood").value || "");
  const moodPreset = byId(presets.moods, moodId);
  const moodLabel = (moodPreset && moodPreset.id !== "none") ? escHtml(moodPreset.label || "") : "";
  const moodBg = (moodPreset && moodPreset.id !== "none") ? escAttr(moodPreset.bg || "#ebf7fb") : "#ebf7fb";
  const moodText = (moodPreset && moodPreset.id !== "none") ? escAttr(moodPreset.text || "#344054") : "#344054";
  const summary = getRichContentForRender(
    "highlight.summary",
    markdownToEmailHtml(document.getElementById("highlight_summary").value)
  );
  const summaryEditable = wrapEditableRich(summary, "highlight.summary", interactive);
  const buttonLabel = wrapEditablePlain(
    escHtml(document.getElementById("highlight_button").value || "View post"),
    "highlight.button",
    interactive
  );

  const titleHtml = title
    ? (url
      ? `<a href="${url}" target="_blank" style="color:#344054; text-decoration:none; font-family:'Fraunces', Georgia, 'Times New Roman', serif;">${title}</a>`
      : title)
    : "";

  const authorRow = (avatar || username || moodLabel) ? `
        <table role="presentation" width="100%" style="margin-top:12px;">
          <tr>
            ${avatar ? `<td width="28" valign="middle">
              <img src="${avatar}"
                   width="24" height="24" alt="${avatarAlt}"
                   style="display:block; border-radius:50%;">
            </td>` : ""}
            <td valign="middle" style="${avatar ? "padding-left:10px;" : ""} font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; color:#344054;">
              ${username ? `<span style="font-weight:500;">${username}</span>` : ""}
              ${moodLabel ? `<span style="display:inline-block; margin-left:${username ? "10px" : "0"}; background-color:${moodBg}; border-radius:24px;
                           color:${moodText}; font-size:14px; padding:2px 8px;">
                ${moodLabel}
              </span>` : ""}
            </td>
          </tr>
        </table>` : "";

  const inner = `
${sectionLabelRow}
<tr><td align="center" class="pad" style="padding:0 20px 12px 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="width:100%; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; border-collapse:separate; box-shadow:0 2px 8px rgba(16,24,40,0.08);">
    <tr>
      <td style="padding:20px;">
        ${titleHtml ? `<table role="presentation" width="100%">
          <tr>
            <td style="font-family:'Fraunces', Georgia, 'Times New Roman', serif; font-size:20px; font-weight:600; color:#344054; line-height:1.3;">
              ${titleHtml}
            </td>
          </tr>
        </table>` : ""}
        ${authorRow}
        ${(summary || interactive) ? `<table role="presentation" width="100%" style="margin-top:12px;">
          <tr>
            <td style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:14px; font-weight:500; line-height:1.5; color:#344054;">
              ${summaryEditable}
            </td>
          </tr>
        </table>` : ""}
      </td>
    </tr>
    ${url ? `<tr>
      <td align="center"
          style="background-color:#227f9c; padding:14px 20px; border-radius:0 0 12px 12px;">
        <a href="${url}"
           target="_blank"
           style="display:inline-block; color:#f1ede9; font-family:'Lexend', Helvetica, Arial, sans-serif;
                  font-size:14px; font-weight:700; text-decoration:none;">
          ${buttonLabel}
          <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
               width="16" height="16" alt="›"
               style="vertical-align:middle; margin-left:8px;">
        </a>
      </td>
    </tr>` : ""}
  </table>
</td></tr>`;

  return sectionWrapper(bg, inner, options);
}

function buildFeatureSlot(bg, options = {}){
  const interactive = !!options.interactive;
  const headerInput = String(document.getElementById("feature_header").value || "").trim();
  const header = headerInput
    ? wrapEditablePlain(escHtml(headerInput).toUpperCase(), "feature.header", interactive)
    : "";
  const headerRow = header
    ? `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${header}</td></tr>`
    : "";
  const topText = getRichContentForRender(
    "feature.topText",
    markdownToEmailHtml(document.getElementById("feature_top_text").value)
  );
  const topTextEditable = wrapEditableRich(topText, "feature.topText", interactive);
  const img = escAttr(document.getElementById("feature_img").value);
  const alt = escHtml(document.getElementById("feature_alt").value);
  const imgLink = escAttr(document.getElementById("feature_img_link").value);
  const imgWidth = clampNumber(document.getElementById("feature_img_width")?.value, 220, 520, 520);
  const bottomText = getRichContentForRender(
    "feature.bottomText",
    markdownToEmailHtml(document.getElementById("feature_bottom_text").value)
  );
  const bottomTextEditable = wrapEditableRich(bottomText, "feature.bottomText", interactive);
  const ctaText1Raw = escHtml(document.getElementById("feature_cta_text_1").value || "Learn more");
  const ctaText1 = wrapEditablePlain(
    ctaText1Raw,
    "feature.cta1Text",
    interactive
  );
  const ctaUrl1 = escAttr(document.getElementById("feature_cta_url_1").value);
  const ctaText2Raw = escHtml(document.getElementById("feature_cta_text_2").value);
  const ctaText2 = wrapEditablePlain(
    ctaText2Raw,
    "feature.cta2Text",
    interactive
  );
  const ctaUrl2 = escAttr(document.getElementById("feature_cta_url_2").value);
  const cta1Valid = !!(ctaText1Raw && ctaUrl1);
  const cta2Valid = !!(ctaText2Raw && ctaUrl2);

  const ctaRow = (cta1Valid || cta2Valid) ? `
        <table role="presentation" width="100%" style="margin-top:12px;">
          <tr>
            <td align="center" style="padding-bottom:4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="podcast-btn-row">
                <tr>
                  ${cta1Valid ? `<td align="center" style="padding:0 4px;">
                    <a href="${ctaUrl1}" target="_blank"
                      style="display:inline-block; background-color:#227f9c; padding:10px 20px;
                             border-radius:12px; border:1px solid #227f9c;
                             font-family:'Lexend', Helvetica, Arial, sans-serif;
                             font-size:15px; font-weight:800; color:#ffffff;
                             text-decoration:none; white-space:nowrap;">
                      ${ctaText1}
                      <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
                           width="16" height="16" alt="›"
                           style="vertical-align:middle; margin-left:8px;">
                    </a>
                  </td>` : ""}
                  ${cta2Valid ? `<td align="center" style="padding:0 4px;">
                    <a href="${ctaUrl2}" target="_blank"
                      style="display:inline-block; background-color:#227f9c; padding:10px 20px;
                             border-radius:12px; border:1px solid #227f9c;
                             font-family:'Lexend', Helvetica, Arial, sans-serif;
                             font-size:15px; font-weight:800; color:#ffffff;
                             text-decoration:none; white-space:nowrap;">
                      ${ctaText2}
                      <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
                           width="16" height="16" alt="›"
                           style="vertical-align:middle; margin-left:8px;">
                    </a>
                  </td>` : ""}
                </tr>
              </table>
            </td>
          </tr>
        </table>` : "";

  const inner = `
${headerRow}
<tr><td align="center" class="pad" style="padding:0 20px 12px 20px;">
  ${(topText || interactive) ? `<table role="presentation" width="100%">
    <tr>
      <td style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#344054;">
        ${topTextEditable}
      </td>
    </tr>
  </table>` : ""}
  ${img ? `<table role="presentation" width="100%" style="margin-top:${topText ? "12px" : "0"};">
    <tr>
      <td align="center">
        ${imgLink ? `<a href="${imgLink}" target="_blank" style="display:block; text-decoration:none;">` : ""}
        <img src="${img}" width="${imgWidth}" alt="${alt}"
             style="display:block; width:100%; max-width:${imgWidth}px; border-radius:12px; height:auto;">
        ${imgLink ? `</a>` : ""}
      </td>
    </tr>
  </table>` : ""}
  ${(bottomText || interactive) ? `<table role="presentation" width="100%" style="margin-top:12px;">
    <tr>
      <td style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#344054;">
        ${bottomTextEditable}
      </td>
    </tr>
  </table>` : ""}
  ${ctaRow}
</td></tr>`;

  return sectionWrapper(bg, inner, options);
}

function buildInThisNewsletter(bg, options = {}){
  const interactive = !!options.interactive;
  const contentHtml = getRichContentForRender(
    "inThisNewsletter.body",
    markdownToEmailHtml(document.getElementById("in_this_newsletter_markdown").value)
  );
  if (!contentHtml && !interactive) return "";
  const editableContent = wrapEditableRich(contentHtml, "inThisNewsletter.body", interactive);

  const inner = `
<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">IN THIS NEWSLETTER</td></tr>
<tr><td align="left" class="pad" style="padding:0 20px 12px 20px;">
  ${editableContent}
</td></tr>`;

  return sectionWrapper(bg, inner, options);
}

function buildPodcasts(bg, options = {}){
  if (!Array.isArray(state.podcasts) || state.podcasts.length === 0) {
    state.podcasts = [blankPodcast()];
  }
  const headerLabel = String(document.getElementById("podcasts_header")?.value || "PODCASTS").trim().toUpperCase();
  const headerRow = `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${escHtml(headerLabel)}</td></tr>`;

  const cardsHtml = state.podcasts.map(p => {
    const quoteSafe = String(p.quote || "").trim();
    const titleSafe = escHtml(String(p.title || "").trim());
    const ytSafe = escAttr(String(p.yt || "").trim());
    const spSafe = escAttr(String(p.sp || "").trim());
    const imgSafe = escAttr(String(p.img || "").trim());
    const altSafe = escHtml(String(p.alt || "").trim());

    const quoteRow = quoteSafe
      ? `<tr><td align="left" class="pad" style="padding:4px 20px; font-family:'Fraunces', Georgia, 'Times New Roman', serif; font-size:16px; line-height:1.6; color:#344054; font-weight:700;">&ldquo;${escHtml(quoteSafe)}&rdquo;</td></tr>`
      : "";

    const thumbHtml = imgSafe
      ? (ytSafe
        ? `<a href="${ytSafe}" target="_blank"><img src="${imgSafe}" alt="${altSafe}" style="display:block; width:auto; height:80px; border-radius:4px;"></a>`
        : `<img src="${imgSafe}" alt="${altSafe}" style="display:block; width:auto; height:80px; border-radius:4px;">`)
      : "";

    const ytBtn = ytSafe ? `<td style="padding-right:8px;">
      <a href="${ytSafe}" target="_blank"
        style="display:inline-block; background-color:#227f9c; padding:10px 20px;
               border-radius:12px; border:1px solid #227f9c;
               font-family:'Lexend', Helvetica, Arial, sans-serif;
               font-size:15px; font-weight:800; color:#ffffff;
               text-decoration:none; white-space:nowrap;">
        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/YouTube_full-color_icon_%282024%29.svg/330px-YouTube_full-color_icon_%282024%29.svg.png"
             width="24" height="14" alt=""
             style="vertical-align:-1px; margin-right:6px; display:inline-block; filter: grayscale(1) invert(1);">
        Watch
      </a>
    </td>` : "";

    const spBtn = spSafe ? `<td>
      <a href="${spSafe}" target="_blank"
        style="display:inline-block; background-color:#227f9c; padding:10px 20px;
               border-radius:12px; border:1px solid #227f9c;
               font-family:'Lexend', Helvetica, Arial, sans-serif;
               font-size:15px; font-weight:800; color:#ffffff;
               text-decoration:none; white-space:nowrap;">
        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Spotify_icon.svg/250px-Spotify_icon.svg.png"
             width="14" height="14" alt=""
             style="vertical-align:-1px; margin-right:6px; display:inline-block; filter: grayscale(1) invert(1);">
        Listen
      </a>
    </td>` : "";

    const cardRow = `<tr><td align="left" class="pad" style="padding:0 20px 16px 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${titleSafe ? `<tr><td style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.5; color:#344054; font-weight:700; padding-bottom:12px;">${titleSafe}</td></tr>` : ""}
          ${(ytBtn || spBtn) ? `<tr><td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="podcast-btn-row">
              <tr>${ytBtn}${spBtn}</tr>
            </table>
          </td></tr>` : ""}
        </table>
      </td>
      ${thumbHtml ? `<td valign="top" align="right" width="140" style="width:140px; padding-left:16px;">${thumbHtml}</td>` : ""}
    </tr>
  </table>
</td></tr>`;

    return quoteRow + cardRow;
  }).join("\n");

  const inner = headerRow + "\n" + cardsHtml;
  return sectionWrapper(bg, inner, options);
}


function buildAdmissionsBlog(bg, options = {}){
  const interactive = !!options.interactive;
  const header = "ADMISSIONS UPDATE";
  const desc   = getRichContentForRender(
    "admissionsBlog.body",
    markdownToEmailHtml(document.getElementById("blog_desc").value)
  );
  const editableDesc = wrapEditableRich(desc, "admissionsBlog.body", interactive);

  // Fixed author
  const authorName = "Jake Baska";
  const authorAvatar =
    "https://www.gravatar.com/avatar/078822ac5e3142951af136795491c23c?size=80&default=robohash";

  const inner = `
<tr>
  <td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${header}</td>
</tr>

<tr>
  <td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="90%">
      <tr>
        <td align="left" style="padding-top:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:14px; font-weight:700; color:#15b79e; padding-right:10px;">
                From the desk of
              </td>
              <td width="24" valign="middle">
                <img src="${authorAvatar}"
                     width="24" height="24"
                     style="display:block; border-radius:50%; border:1px solid #e5e7eb;"
                     alt="${authorName}">
              </td>
              <td valign="middle"
                  style="padding-left:8px;
                         font-family:'Lexend', Helvetica, Arial, sans-serif;
                         font-size:16px;
                         color:#15b79e;">
                <strong>${authorName}</strong>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${(desc || interactive) ? `
      <tr>
        <td align="left"
            style="padding-top:10px;
                   font-family:'Lexend', Helvetica, Arial, sans-serif;
                   font-size:16px;
                   line-height:1.6;
                   color:#344054;">
          ${editableDesc}
        </td>
      </tr>` : ""}

    </table>
  </td>
</tr>`;

  return sectionWrapper(bg, inner, options);
}


function buildDiscussion(bg, options = {}){
  const interactive = !!options.interactive;
  const sectionLabelInput = String(document.getElementById("discussion_label")?.value || "").trim();
  const sectionLabel = sectionLabelInput
    ? wrapEditablePlain(escHtml(sectionLabelInput).toUpperCase(), "discussion.header", interactive)
    : "";
  const sectionLabelRow = sectionLabel
    ? `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${sectionLabel}</td></tr>`
    : "";
  const divider = `<div style="height:1px; border-top:1px solid #e5e7eb; margin:16px 0;"></div>`;
  const postsHtml = state.discussion.map((p, i) => {
    const topic = byId(presets.topics, p.topicId);
    const mood = byId(presets.moods, p.moodId);

    const moodHtml = (mood && mood.id !== "none" && mood.label)
      ? `<span style="display:inline-block; padding:2px 6px; background-color:${escAttr(mood.bg)}; border-radius:999px;
                       font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; font-weight:800; color:${escAttr(mood.text)};
                       line-height:1.2; white-space:nowrap;">${escHtml(mood.label)}</span>`
      : "";

    return `
      <div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="top" width="32" style="width:32px; padding-right:10px;">
              ${p.avatar ? `<img src="${escAttr(p.avatar)}" width="32" height="32" style="display:block; border-radius:50%; background-color:#f9fafb;" alt="">` : ""}
            </td>
            <td valign="top">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="left" style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:13px; font-weight:800; color:#227f9c; line-height:1.3;">
                    ${escHtml(topic?.label || "")}${p.when ? `<span style="color:#898989; font-weight:500">• ${inlineMarkdownToHtml(p.when)}</span>` : ""}
                  </td>
                  <td align="right">
                    ${p.url ? `<a href="${escAttr(p.url)}" target="_blank"
                       style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; font-weight:700; color:#b3b8c4; text-decoration:none; white-space:nowrap;">
                      See the post
                      <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
                           width="12" height="12" alt=""
                           style="vertical-align:middle; margin-left:6px;">
                    </a>` : ""}
                  </td>
                </tr>
              </table>
              <div style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:13px; color:#667085; line-height:1.3; margin-top:2px;">
                ${p.username ? `<span style="font-weight:800; color:#344054;">${escHtml(p.username)}</span>` : ""}${moodHtml ? ` ${moodHtml}` : ""}
              </div>
            </td>
          </tr>
          ${p.title ? `<tr>
            <td colspan="2" style="padding-top:10px;">
              ${p.url ? `<a href="${escAttr(p.url)}" target="_blank"
                 style="font-family:'Fraunces', Georgia, serif; font-size:18px; font-weight:700; color:#227f9c; line-height:1.3; text-decoration:none;">
                ${inlineMarkdownToHtml(p.title, { allowLinks: false })}
              </a>` : `<div style="font-family:'Fraunces', Georgia, serif; font-size:18px; font-weight:700; color:#227f9c; line-height:1.3;">${inlineMarkdownToHtml(p.title)}</div>`}
            </td>
          </tr>` : ""}
        </table>
      </div>
      ${i < state.discussion.length - 1 ? divider : ""}`;
  }).join("");

  const inner = `
${sectionLabelRow}
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="margin-top:4px; box-shadow:0 2px 8px rgba(16,24,40,0.08); border-radius:12px;">
    <tr><td style="background:#ffffff; border:1px solid #e5e7eb; border-bottom:0; border-radius:12px 12px 0 0; padding:16px 20px;">
      ${postsHtml}
    </td></tr>
    <tr>
      <td align="center"
          style="background-color:#227f9c; border-left:1px solid #e5e7eb; border-right:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; border-radius:0 0 12px 12px; padding:12px 16px;">
        <a href="https://7sage.com/discussion" target="_blank"
           style="display:inline-block; color:#ffffff; font-family:'Lexend', Helvetica, Arial, sans-serif;
                  font-size:14px; font-weight:800; text-decoration:none;">
          See more posts
          <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
               width="16" height="16" alt="›"
               style="vertical-align:middle; margin-left:8px;">
        </a>
      </td>
    </tr>
  </table>
</td></tr>`;
  return sectionWrapper(bg, inner, options);
}

function buildLiveClasses(bg, options = {}){
  const dot = (color) => `<span style="display:inline-block; width:8px; height:8px; border-radius:2px; background-color:${color}; margin-right:4px;"></span>`;

  const rows = state.classes.map(r => {
    const instr = byId(presets.instructors, r.instructorId) || presets.instructors[0] || { avatar:"" };
    const diff = byId(presets.difficulties, r.difficultyId) || presets.difficulties[0] || { label:"", filledCount:1, filled:"#2a6c7f", empty:"#e5eef2" };
    const filledCount = Math.max(0, Math.min(3, Number(diff.filledCount ?? 1)));
    const dots = [0,1,2].map(i => dot(i < filledCount ? escAttr(diff.filled) : escAttr(diff.empty))).join("");

    return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e5e7eb;">
        <tr>
          <td valign="middle" width="120" style="width:120px; padding:16px 12px; font-family:'Lexend', Helvetica, Arial, sans-serif; color:#1f2d3d;">
            <div style="font-size:18px; font-weight:800; line-height:1.2;">${escHtml(r.time)}</div>
            <div style="font-size:14px; font-weight:700; color:#6b7280; line-height:1.2;">${escHtml(r.date)}</div>
          </td>

          <td valign="middle" width="36" style="width:36px; padding:16px 10px;">
            ${instr.avatar ? `<img src="${escAttr(instr.avatar)}" width="36" height="36"
                 style="display:block; border-radius:50%; border:1px solid #e5e7eb;" alt="">` : ""}
          </td>

          <td valign="middle" style="padding:16px 0; font-family:'Lexend', Helvetica, Arial, sans-serif; color:#1f2d3d;">
            <div style="font-size:14px; font-weight:800; color:#2a6c7f; line-height:1.2;">
              ${r.url ? `<a href="${escAttr(r.url)}" target="_blank" style="color:#2a6c7f; text-decoration:none;">${inlineMarkdownToHtml(r.title, { allowLinks: false })}</a>` : inlineMarkdownToHtml(r.title)}
            </div>
            <div style="margin-top:6px; font-size:14px; color:#6b7280; white-space:nowrap; display:inline-block; font-weight:700;">
              ${dots}<span style="margin-left:4px;">${escHtml(diff.label)}</span>
            </div>
          </td>

          <td valign="middle" align="right" width="140" style="width:140px; padding:16px 12px;">
            ${r.url ? `<a href="${escAttr(r.url)}" target="_blank"
               style="display:inline-block; background-color:#227f9c; color:#ffffff;
                      font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:15px;
                      font-weight:800; padding:10px 20px; border-radius:12px; border:1px solid #227f9c; text-decoration:none;">
              RSVP
            </a>` : ""}
          </td>
        </tr>
      </table>`;
  }).join("");

  const inner = `
<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">FREE LIVE CLASSES</td></tr>
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="margin-top:12px; box-shadow:0 2px 8px rgba(16,24,40,0.08); border-radius:12px;">
    <tr><td style="background:#ffffff; border:1px solid #e5e7eb; border-bottom:0; border-radius:12px 12px 0 0;">
      ${rows}
    </td></tr>
    <tr><td style="background:#ffffff; border-left:1px solid #e5e7eb; border-right:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; border-radius:0 0 12px 12px; height:14px; font-size:0;">&nbsp;</td></tr>
  </table>
</td></tr>`;
  return sectionWrapper(bg, inner, options);
}

function buildCustomLinks(bg, options = {}){
  const blocks = state.customLinks
    .filter(x => (x.prompt || x.linkText || x.url))
    .map(x => {
      const prompt = inlineMarkdownToHtml(x.prompt);
      const linkText = inlineMarkdownToHtml(x.linkText, { allowLinks: false });
      const url = escAttr(x.url);
      const link = (url && linkText)
        ? `<a href="${url}" style="color:#227f9c; text-decoration:none; font-weight:800;">${linkText}</a>`
        : (linkText || "");
      const joined = [prompt, link].filter(Boolean).join(" ");
      return `<div style="margin-bottom:14px;">${joined}</div>`;
    }).join("");

  const inner = `
<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">EXTRAS</td></tr>
<tr><td align="left" class="pad" style="padding:0 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.6; color:#344054;">
  ${blocks || ""}
</td></tr>`;
  return sectionWrapper(bg, inner, options);
}

function inlineMarkdownToHtml(text, options = {}){
  const allowLinks = options.allowLinks !== false;
  function decorateEscapedInline(escaped){
    let html = escaped
      .replace(/`([^`]+)`/g, "<code style=\"font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono'; background:#f2f4f7; padding:1px 4px; border-radius:4px;\">$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>");
    if (allowLinks) {
      html = html.replace(/(https?:\/\/[^\s<]+)/g, "<a href=\"$1\" target=\"_blank\" style=\"color:#227f9c; text-decoration:none; font-weight:700;\">$1</a>");
    }
    return html;
  }

  const raw = String(text || "");
  if (!allowLinks) return decorateEscapedInline(escHtml(raw));

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let html = "";
  let cursor = 0;
  let match;

  while ((match = linkPattern.exec(raw)) !== null) {
    const [full, label, href] = match;
    html += decorateEscapedInline(escHtml(raw.slice(cursor, match.index)));
    html += `<a href="${escAttr(href)}" target="_blank" style="color:#227f9c; text-decoration:none; font-weight:700;">${decorateEscapedInline(escHtml(label))}</a>`;
    cursor = match.index + full.length;
  }

  html += decorateEscapedInline(escHtml(raw.slice(cursor)));
  return html;
}

function markdownToEmailHtml(markdown){
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let paragraph = [];
  let inUl = false;
  let inOl = false;

  function closeLists(){
    if (inUl) {
      html += "</ul>";
      inUl = false;
    }
    if (inOl) {
      html += "</ol>";
      inOl = false;
    }
  }

  function flushParagraph(){
    if (!paragraph.length) return;
    html += `<p style="margin:0 0 12px 0; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.65; color:#344054;">${paragraph.map(inlineMarkdownToHtml).join("<br>")}</p>`;
    paragraph = [];
  }

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      closeLists();
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeLists();
      const level = heading[1].length;
      const tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      const size = level === 1 ? "28px" : level === 2 ? "22px" : "18px";
      html += `<${tag} style="margin:0 0 10px 0; font-family:'Fraunces', Georgia, serif; font-size:${size}; line-height:1.3; color:#101828; font-weight:700;">${inlineMarkdownToHtml(heading[2])}</${tag}>`;
      return;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (inOl) {
        html += "</ol>";
        inOl = false;
      }
      if (!inUl) {
        html += "<ul style=\"margin:0 0 12px 0; padding-left:20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.65; color:#344054;\">";
        inUl = true;
      }
      html += `<li style="margin:0 0 6px 0;">${inlineMarkdownToHtml(bullet[1])}</li>`;
      return;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (inUl) {
        html += "</ul>";
        inUl = false;
      }
      if (!inOl) {
        html += "<ol style=\"margin:0 0 12px 0; padding-left:20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:16px; line-height:1.65; color:#344054;\">";
        inOl = true;
      }
      html += `<li style="margin:0 0 6px 0;">${inlineMarkdownToHtml(numbered[1])}</li>`;
      return;
    }

    paragraph.push(line);
  });

  flushParagraph();
  closeLists();
  return html;
}

function buildMarkdownSection(bg, section, options = {}){
  const interactive = !!options.interactive;
  const label = String(section?.label || "").trim();
  const richKey = previewMarkdownRichKey(section?.id);
  const contentHtml = getRichContentForRender(richKey, markdownToEmailHtml(section?.markdown || ""));
  const htmlFragment = sanitizeInjectedHtmlFragment(section?.htmlFragment || "");
  const imageUrl = escAttr(section?.imageUrl || "");
  const imageAlt = escAttr(section?.imageAlt || "");
  const imageLinkUrl = escAttr(section?.imageLinkUrl || "");
  const imageWidth = clampNumber(section?.imageWidth, 220, 560, 520);
  const hasCta = !!(String(section?.ctaText || "").trim() && String(section?.ctaUrl || "").trim());
  const ctaText = inlineMarkdownToHtml(section?.ctaText || "", { allowLinks: false });
  const ctaUrl = escAttr(section?.ctaUrl || "");
  if (!contentHtml && !htmlFragment && !imageUrl && !hasCta && !interactive) return "";

  const sectionLabel = label
    ? wrapEditablePlain(
        escHtml(label).toUpperCase(),
        previewMarkdownLabelKey(section?.id),
        interactive
      )
    : "";
  const sectionLabelRow = sectionLabel
    ? `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${sectionLabel}</td></tr>`
    : "";
  const imageTag = imageUrl
    ? `<img src="${imageUrl}"
         alt="${imageAlt}"
         width="${imageWidth}"
         style="display:block; width:100%; max-width:${imageWidth}px; height:auto; border:0; border-radius:12px;">`
    : "";
  const imageLinkedTag = (imageTag && imageLinkUrl)
    ? `<a href="${imageLinkUrl}" target="_blank" style="display:inline-block; text-decoration:none;">${imageTag}</a>`
    : imageTag;
  const imageHtml = imageLinkedTag ? `
<tr><td align="center" class="pad" style="padding:6px 20px 12px 20px;">
  ${imageLinkedTag}
</td></tr>` : "";
  const ctaHtml = (ctaText && ctaUrl) ? `
<tr><td align="center" class="pad" style="padding:6px 20px 14px 20px;">
  <a href="${ctaUrl}" target="_blank"
     style="display:inline-block; background-color:#227f9c; color:#ffffff;
            font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:15px;
            font-weight:800; padding:10px 20px; border-radius:12px;
            border:1px solid #227f9c; text-decoration:none;">
    ${ctaText}
    <img src="https://ik.imagekit.io/7sage/Newsletter%20Files/Newsletter%20Files%202/rightchevron.png"
         width="16" height="16" alt=""
         style="vertical-align:middle; margin-left:8px;">
  </a>
</td></tr>` : "";
  const contentRow = (contentHtml || interactive) ? `
<tr><td align="left" class="pad" style="padding:0 20px 12px 20px;">
  ${wrapEditableRich(contentHtml, richKey, interactive)}
</td></tr>` : "";
  const htmlFragmentRow = htmlFragment ? `
<tr><td align="left" class="pad" style="padding:0 20px 12px 20px;">
  ${htmlFragment}
</td></tr>` : "";
  const inner = `
${sectionLabelRow}
${contentRow}
${htmlFragmentRow}
${imageHtml}
${ctaHtml}`;

  return sectionWrapper(bg, inner, options);
}

function sanitizeInjectedHtmlFragment(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .trim();
}

function buildHtmlFragmentSection(bg, fragment, options = {}){
  const interactive = !!options.interactive;
  const fragmentLabel = String(fragment?.label || "").trim();
  const sectionLabel = fragmentLabel
    ? wrapEditablePlain(
        escHtml(fragmentLabel).toUpperCase(),
        `htmlFragment.${fragment?.id}.label`,
        interactive
      )
    : "";
  const sectionLabelRow = sectionLabel
    ? `<tr><td align="center" class="pad" style="padding:2px 20px 12px 20px; font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.4px; color:#b3b8c4; font-weight:800;">${sectionLabel}</td></tr>`
    : "";
  const htmlFragment = sanitizeInjectedHtmlFragment(fragment?.html || "");
  if (!htmlFragment && !interactive) return "";

  const fallback = `<div style="font-family:'Lexend', Helvetica, Arial, sans-serif; font-size:14px; color:#667085;">Paste an HTML fragment in the sidebar to render this section.</div>`;
  const inner = `
${sectionLabelRow}
<tr><td align="left" class="pad" style="padding:0 20px 12px 20px;">
  ${htmlFragment || fallback}
</td></tr>`;

  return sectionWrapper(bg, inner, options);
}

/** ------------------------ generation (alternating backgrounds) ------------------------ **/
function buildSectionById(sectionId, bg, options = {}){
  if (sectionId === "highlight") return buildHighlight(bg, options);
  if (sectionId === "inThisNewsletter") return buildInThisNewsletter(bg, options);
  if (sectionId === "featureSlot") return buildFeatureSlot(bg, options);
  if (sectionId === "podcasts") return buildPodcasts(bg, options);
  if (sectionId === "admissionsBlog") return buildAdmissionsBlog(bg, options);
  if (sectionId === "discussion") return buildDiscussion(bg, options);
  if (sectionId === "liveClasses") return buildLiveClasses(bg, options);
  if (sectionId === "customLinks") return buildCustomLinks(bg, options);
  if (isMarkdownSectionId(sectionId)) {
    const markdownSection = state.markdownSections.find(x => x.id === sectionId);
    return markdownSection ? buildMarkdownSection(bg, markdownSection, options) : "";
  }
  if (isHtmlFragmentId(sectionId)) {
    const htmlFragment = state.htmlFragments.find(x => x.id === sectionId);
    return htmlFragment ? buildHtmlFragmentSection(bg, htmlFragment, options) : "";
  }

  return "";
}

function buildSectionsHtml(options = {}){
  const interactive = !!options.interactive;
  const enabled = state.sections.filter(s => s.enabled);
  const colors = ["#fefcfa", "#fcfaf8"];
  let out = "";
  let idx = 0;

  for (const s of enabled) {
    const bg = colors[idx % 2];
    const sectionHtml = buildSectionById(s.id, bg, { ...options, sectionId: s.id });

    if (sectionHtml) {
      if (interactive) out += buildSectionDropzoneRow(idx);
      out += sectionHtml;
      idx++;
    }
  }

  if (interactive) out += buildSectionDropzoneRow(idx);
  return out;
}

function renderEmailHtml(options = {}) {
  const preheader = escHtml(document.getElementById("preheader").value);
  const unsubUrl = escAttr(document.getElementById("unsubscribe_url").value || "{{unsubscribe_url}}");
  const sectionsHtml = buildSectionsHtml(options);
  return emailShell({ preheader, sectionsHtml, unsubUrl });
}

function renderForPreview(interactive = true) {
  return renderEmailHtml({ interactive: !!interactive });
}

function renderForExport() {
  return renderEmailHtml({ interactive: false });
}

function generateHtml(){
  const preview = document.getElementById("preview");
  if (!preview) return;
  const interactive = !!ensurePreviewEditorState().enabled;
  preview.srcdoc = interactive ? renderForPreview(true) : renderForExport();
}



/** ------------------------ buttons ------------------------ **/
document.getElementById("copyBtn").addEventListener("click", async () => {
  const html = renderForExport();
  try {
    await navigator.clipboard.writeText(html);
    alert("Copied HTML to clipboard.");
  } catch {
    alert("Clipboard copy failed.");
  }
});

const modeToggleBtn = document.getElementById("modeToggleBtn");
if (modeToggleBtn) {
  modeToggleBtn.addEventListener("click", () => {
    const enabled = !!ensurePreviewEditorState().enabled;
    setPreviewEditMode(!enabled);
  });
}

const previewFrame = document.getElementById("preview");
if (previewFrame) {
  previewFrame.addEventListener("load", bindPreviewEditorInteractions);
}

const featureImgWidthSlider = document.getElementById("feature_img_width");
if (featureImgWidthSlider) {
  featureImgWidthSlider.addEventListener("input", syncFeatureImageWidthValue);
}

const projectSelect = document.getElementById("projectSelect");
if (projectSelect) {
  projectSelect.addEventListener("change", () => {
    const nextId = String(projectSelect.value || "");
    if (!nextId || nextId === activeProjectId) return;
    switchToProject(nextId, { persistCurrent: true });
  });
}

const saveProjectBtn = document.getElementById("saveProjectBtn");
if (saveProjectBtn) {
  saveProjectBtn.addEventListener("click", () => {
    const nameInput = document.getElementById("projectNameInput");
    const active = getActiveProjectEntry();
    if (!active) return;
    const requestedName = normalizeProjectName(nameInput?.value, active.name || PROJECT_DEFAULT_NAME);
    active.name = makeUniqueProjectName(requestedName, active.id);
    syncActiveProjectSnapshot();
    alert(`Saved "${active.name}".`);
  });
}

const saveAsProjectBtn = document.getElementById("saveAsProjectBtn");
if (saveAsProjectBtn) {
  saveAsProjectBtn.addEventListener("click", () => {
    if (!projectFilesystem) return;
    const nameInput = document.getElementById("projectNameInput");
    syncActiveProjectSnapshot({ skipUi: true });
    const created = createProjectFromCurrent(nameInput?.value);
    saveProjectFilesystem();
    switchToProject(created.id, { persistCurrent: false });
    alert(`Created "${created.name}".`);
  });
}

const newProjectBtn = document.getElementById("newProjectBtn");
if (newProjectBtn) {
  newProjectBtn.addEventListener("click", () => {
    if (!projectFilesystem) return;
    const nameInput = document.getElementById("projectNameInput");
    syncActiveProjectSnapshot({ skipUi: true });
    const created = createBlankProject(nameInput?.value || `Project ${projectFilesystem.projects.length + 1}`);
    saveProjectFilesystem();
    switchToProject(created.id, { persistCurrent: false });
    alert(`Created blank project "${created.name}".`);
  });
}

const deleteProjectBtn = document.getElementById("deleteProjectBtn");
if (deleteProjectBtn) {
  deleteProjectBtn.addEventListener("click", () => {
    if (!projectFilesystem || projectFilesystem.projects.length <= 1) {
      alert("At least one project must remain.");
      return;
    }
    const active = getActiveProjectEntry();
    if (!active) return;

    const confirmed = window.confirm(`Delete project "${active.name}"? This cannot be undone.`);
    if (!confirmed) return;

    const index = projectFilesystem.projects.findIndex(project => project.id === active.id);
    if (index < 0) return;
    projectFilesystem.projects.splice(index, 1);
    const next = projectFilesystem.projects[Math.max(0, index - 1)] || projectFilesystem.projects[0];
    if (!next) return;
    saveProjectFilesystem();
    switchToProject(next.id, { persistCurrent: false });
    alert(`Deleted "${active.name}".`);
  });
}

const exportProjectBtn = document.getElementById("exportProjectBtn");
if (exportProjectBtn) {
  exportProjectBtn.addEventListener("click", () => {
    const exported = exportActiveProjectAsJson();
    if (!exported) {
      alert("No active project to export.");
      return;
    }
    const active = getActiveProjectEntry();
    if (active) alert(`Exported "${active.name}" to JSON.`);
  });
}

const importProjectBtn = document.getElementById("importProjectBtn");
const importProjectFile = document.getElementById("importProjectFile");
if (importProjectBtn && importProjectFile) {
  importProjectBtn.addEventListener("click", () => {
    importProjectFile.click();
  });

  importProjectFile.addEventListener("change", async () => {
    const file = importProjectFile.files?.[0];
    if (!file) return;

    try {
      const fileText = await file.text();
      const parsed = JSON.parse(fileText);
      syncActiveProjectSnapshot({ skipUi: true });
      const importedProjectIds = importProjectsFromPayload(parsed);

      if (!importedProjectIds.length) {
        alert("Import failed: JSON does not contain a recognized project payload.");
        return;
      }

      switchToProject(importedProjectIds[0], { persistCurrent: false });
      const count = importedProjectIds.length;
      alert(count === 1 ? "Imported 1 project from JSON." : `Imported ${count} projects from JSON.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      alert(`Import failed: ${message}`);
    } finally {
      importProjectFile.value = "";
    }
  });
}
  
document.addEventListener("input", (e) => {
  if (
    e.target.matches("input, textarea, select") &&
    !e.target.closest('[data-section="admin"]') &&
    !e.target.closest("[data-storage-ui]")
  ) {
    clearLinkedRichOverridesForInput(e.target);

    // Markdown/HTML fragment fields manage their own debounced generation.
    if (e.target.closest("details[data-markdown-section-id]")) return;
    if (e.target.closest("details[data-html-fragment-id]")) return;

    const block = e.target.closest("details[data-section-id]");
    if (block) {
      const section = state.sections.find(s => s.id === block.dataset.sectionId);
      if (section && !section.enabled) {
        section.enabled = true;
        saveState();
        renderSectionsUI();
      }
    }
    saveState();
    autoGenerateHtml();
  }
});

/** ------------------------ init ------------------------ **/
function initApp() {
  if (!projectFieldDefaults) projectFieldDefaults = captureProjectFieldValues();
  presets = loadPresets();
  state = loadState();
  ensurePreviewEditorState();
  initProjectFilesystem();

  const active = getActiveProjectEntry();
  if (active?.snapshot) {
    presets = normalizePresets(active.snapshot.presets);
    state = normalizeState(active.snapshot.state);
  }
  ensurePreviewEditorState();

  hydrateUiFromCurrentModels(active?.snapshot?.fields || {});
  renderProjectFilesystemUI();
  syncActiveProjectSnapshot({ skipUi: true });
}

initApp();
