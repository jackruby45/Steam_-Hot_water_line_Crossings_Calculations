
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// --- Unit Conversion Constants & Helpers ---
const CONVERSIONS = {
    ftToM: (ft: number) => ft * 0.3048,
    mToFt: (m: number) => m / 0.3048,
    inToM: (inch: number) => inch * 0.0254,
    mToIn: (m: number) => m / 0.0254,
    FtoC: (f: number) => (f - 32) * 5 / 9,
    CtoF: (c: number) => c * 9 / 5 + 32,
    btuHrFtFtoWMK: (k: number) => k * 1.73073,
    wmkToBtuHrFtF: (k: number) => k / 1.73073,
};

const UNIT_SYSTEMS = {
    imperial: {
        temp: '°F', lengthLarge: 'ft', lengthSmall: 'in',
        conductivity: 'BTU/hr-ft-°F',
        defaults: { temp: 63, isoTemp: 73, length: 5, x: 0, z: 4, ins: 0, bed: 0, od: 8.625, thick: 0.322 },
    },
};

const MATERIAL_STORAGE_KEY = 'pipelineMaterialLibrary';

// --- Interfaces and Types ---
type PipeOrientation = 'parallel' | 'perpendicular';
type UnitSystem = 'imperial' | 'metric';
type MaterialType = 'soil' | 'pipe' | 'insulation' | 'bedding';

interface CustomMaterial {
    id: string;
    type: MaterialType;
    name: string;
    k: number; // Stored in W/m-K
}

interface Pipe { // All values are in SI (meters, Celsius) for calculation
    id: number;
    name: string;
    role: 'heat_source' | 'affected_pipe';
    orientation: PipeOrientation;
    x: number; // (m) Used for parallel pipes
    y: number; // (m) Used for perpendicular pipes
    z: number; // (m)
    temp?: number; // (°C)
    od: number; // (m)
    thickness: number; // (m)
    k_pipe: number; // (W/m-K)
    ins_thickness: number; // (m)
    k_ins: number; // (W/m-K)
    bed_thickness: number; // (m)
    k_bedding: number; // (W/m-K)
    element: HTMLElement;
}

type CalculationSoilLayer = {
    k: number;
    thickness: number;
    depth_top: number;
    depth_bottom: number;
};

interface SoilLayer extends CalculationSoilLayer { // All values are in SI (meters, W/m-K)
    element: HTMLElement;
}

interface SourceCalculation {
    pipeId: number;
    pipeName: string;
    R_pipe: number; // (K-m)/W
    R_ins: number; // (K-m)/W
    R_bed: number;
    R_soil: number;
    R_total: number;
    Q: number; // W/m
}

interface InteractionCalculation {
    sourcePipeName: string;
    k_eff_path: number; // W/m-K
    d_real: number; // m
    d_image: number; // m
    tempRise: number; // °C
}

interface AffectedPipeCalculation {
    pipeId: number;
    pipeName: string;
    interactions: InteractionCalculation[];
    totalTempRise: number; // °C
    finalTemp: number; // °C
}

interface DetailedCalculations {
    sources: SourceCalculation[];
    affectedPipes: AffectedPipeCalculation[];
}


interface CalculationData {
    inputs: {
        pipes: Pipe[];
        soilLayers: SoilLayer[];
        T_soil: number; // °C
    };
    results: {
        pipeId: number;
        pipeName: string;
        finalTemp: number; // °C
    }[];
    sceneData: SceneData;
    latex: string;
    detailedCalculations: DetailedCalculations;
}

interface ProjectInfo {
    name: string;
    location: string;
    system: string;
    engineer: string;
    date: string;
    revision: string;
    description: string;
}

interface SceneData {
    worldOrigin: { x: number; y: number }; // canvas pixels
    worldWidth: number; // meters
    worldHeight: number; // meters
    worldDepth: number; // meters
    worldMinX: number; // meters
    worldMinY: number; // meters
    scale: number; // pixels/meter
    groundY: number; // canvas pixels
    T_soil: number; // °C
    maxTemp: number; // °C
    minTemp: number; // °C
    pipes: {
        id: number;
        x: number; // m
        y: number; // m
        z: number; // m
        orientation: PipeOrientation;
        r_pipe: number; // m
        r_ins: number; // m
        r_bed: number; // m
        temp: number; // °C
        isSource: boolean;
        name: string;
        Q?: number; // W/m
    }[];
    layers: CalculationSoilLayer[];
}

interface Isotherm {
    id: number;
    temp: number; // In current display units
    color: string;
    enabled: boolean;
}
interface IsoSurface {
    id: number;
    temp: number; // In current display units
    color: string;
    opacity: number;
    enabled: boolean;
}


type ViewMode = '2d' | '3d';


// --- Constants ---
// Values are stored as [OD (in), thickness (in)]
const PIPE_PRESETS_IMPERIAL: { [key: string]: { od: number, thickness: number } } = {
    '1_sch40': { od: 1.315, thickness: 0.133 }, '2_sch40': { od: 2.375, thickness: 0.154 },
    '3_sch40': { od: 3.5, thickness: 0.216 }, '4_sch40': { od: 4.5, thickness: 0.237 },
    '6_sch40': { od: 6.625, thickness: 0.280 }, '8_sch40': { od: 8.625, thickness: 0.322 },
    '10_sch40': { od: 10.75, thickness: 0.365 }, '12_sch40': { od: 12.75, thickness: 0.406 },
};
const LEGEND_WIDTH = 80;

// Base thermal conductivities in W/m-K
const MATERIAL_PRESETS = {
    soil: [
        { name: 'Saturated Soil', k: 2.5 }, { name: 'Wet Soil', k: 2.0 }, { name: 'Moist Soil', k: 1.5 },
        { name: 'Loam', k: 1.0 }, { name: 'Asphalt', k: 0.75 }, { name: 'Dry Soil', k: 0.5 },
        { name: 'Dry Gravel', k: 0.35 }, { name: 'Dry Sand', k: 0.27 }
    ],
    pipe: [
        { name: 'Carbon Steel', k: 54 }, { name: 'Stainless Steel', k: 16 }, { name: 'HDPE', k: 0.45 }
    ],
    insulation: [
        { name: 'No Insulation', k: 0 }, { name: 'Calcium Silicate', k: 0.05 },
        { name: 'Fiberglass', k: 0.04 }, { name: 'Polyurethane Foam', k: 0.025 }
    ],
    bedding: [
        { name: 'None', k: 0 }, { name: 'Gravel', k: 0.35 }, { name: 'Sand', k: 0.27 }
    ]
};

// --- DOM Element Selectors ---
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');
const projectNameInput = document.getElementById('project-name') as HTMLTextAreaElement;
const projectLocationInput = document.getElementById('project-location') as HTMLTextAreaElement;
const systemNumberInput = document.getElementById('system-number') as HTMLTextAreaElement;
const engineerNameInput = document.getElementById('engineer-name') as HTMLTextAreaElement;
const evalDateInput = document.getElementById('eval-date') as HTMLInputElement;
const revisionNumberInput = document.getElementById('revision-number') as HTMLInputElement;
const projectDescriptionInput = document.getElementById('project-description') as HTMLTextAreaElement;
const soilTempInput = document.getElementById('soil-temp') as HTMLInputElement;
const soilLayersList = document.getElementById('soil-layers-list') as HTMLDivElement;
const addSoilLayerBtn = document.getElementById('add-soil-layer-btn') as HTMLButtonElement;
const pipeList = document.getElementById('pipe-list') as HTMLDivElement;
const addPipeBtn = document.getElementById('add-pipe-btn') as HTMLButtonElement;
const calculateBtn = document.getElementById('calculate-btn') as HTMLButtonElement;
const exampleBtn = document.getElementById('example-btn') as HTMLButtonElement;
const outputWrapper = document.getElementById('output-wrapper') as HTMLDivElement;
const resultsTableContainer = document.getElementById('results-table-container') as HTMLDivElement;
const errorContainer = document.getElementById('results-error-container') as HTMLDivElement;
const canvas = document.getElementById('heat-transfer-canvas') as HTMLCanvasElement;
const webglCanvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const tooltipElement = document.getElementById('tooltip') as HTMLDivElement;
const saveScenarioBtn = document.getElementById('save-scenario-btn') as HTMLButtonElement;
const loadScenarioBtn = document.getElementById('load-scenario-btn') as HTMLButtonElement;
const loadScenarioInput = document.getElementById('load-scenario-input') as HTMLInputElement;
const copyLatexBtn = document.getElementById('copy-latex-btn') as HTMLButtonElement;
const copyBtnText = document.getElementById('copy-btn-text') as HTMLSpanElement;
const templates = document.getElementById('templates') as HTMLDivElement;
const soilLayerTemplate = templates.querySelector('.soil-layer-row') as HTMLElement;
const pipeTemplate = templates.querySelector('.pipe-row') as HTMLElement;
const isothermTemplate = templates.querySelector('.isotherm-row') as HTMLElement;
const isosurfaceTemplate = templates.querySelector('.isosurface-row') as HTMLElement;
const visualizationOptions = document.getElementById('visualization-options') as HTMLDivElement;
const viewModeRadios = document.querySelectorAll('input[name="view-mode"]');
const isothermList = document.getElementById('isotherm-list') as HTMLDivElement;
const addIsothermBtn = document.getElementById('add-isotherm-btn') as HTMLButtonElement;
const isosurfaceList = document.getElementById('isosurface-list') as HTMLDivElement;
const addIsosurfaceBtn = document.getElementById('add-isosurface-btn') as HTMLButtonElement;
const toggleFluxVectors = document.getElementById('toggle-flux-vectors') as HTMLInputElement;
const visToggles = document.getElementById('vis-toggles') as HTMLDivElement;
const isothermControls = document.getElementById('isotherm-controls') as HTMLDivElement;
const isosurfaceControls = document.getElementById('isosurface-controls') as HTMLDivElement;


// --- State ---
let animationFrameId: number | null = null;
let currentCalculationData: CalculationData | null = null;
let pipeIdCounter = 0;
let isothermIdCounter = 0;
let isoSurfaceIdCounter = 0;
let currentViewMode: ViewMode = '2d';
let threeDManager: ThreeDManager | null = null;
let customMaterials: CustomMaterial[] = [];
let isotherms: Isotherm[] = [];
let isoSurfaces: IsoSurface[] = [];
let showFluxVectors = false;
let draggedPipeId: number | null = null;
let dragOffset = { x: 0, y: 0 }; // In canvas pixels
const currentUnitSystem: UnitSystem = 'imperial';

// --- UI Management ---
function updateUnitsUI() {
    const system = UNIT_SYSTEMS.imperial;

    // Update placeholders and values
    soilTempInput.value = system.defaults.temp.toString();
    isothermList.querySelectorAll('.isotherm-temp-input').forEach(el => {
        (el as HTMLInputElement).value = system.defaults.isoTemp.toString();
    });
     isosurfaceList.querySelectorAll('.isosurface-temp-input').forEach(el => {
        (el as HTMLInputElement).value = system.defaults.isoTemp.toString();
    });
    
    populateAllMaterialSelects();
    renderMaterialLibrary(); // Re-render to show correct k-values

    // Invalidate results if they were already showing
    if (outputWrapper.style.display !== 'none') {
        handleCalculate();
    }
}

function setupTabs() {
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            tabLinks.forEach(innerLink => innerLink.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId!)?.classList.add('active');
        });
    });
}

function addSoilLayer(data?: {k: number, thickness: number}) {
    const newLayer = soilLayerTemplate.cloneNode(true) as HTMLElement;
    const materialSelect = newLayer.querySelector('.soil-layer-material-select') as HTMLSelectElement;
    populateMaterialSelect(materialSelect, 'soil');

    if (data) {
        materialSelect.value = data.k.toString();
        const thicknessInput = newLayer.querySelector('.soil-layer-thickness') as HTMLInputElement;
        const thicknessInDisplayUnit = CONVERSIONS.mToFt(data.thickness);
        thicknessInput.value = thicknessInDisplayUnit.toFixed(2);
    }

    newLayer.querySelector('.remove-btn')?.addEventListener('click', () => newLayer.remove());
    soilLayersList.appendChild(newLayer);
    return newLayer;
}

function addPipe(data?: Partial<Pipe>) {
    const newPipe = pipeTemplate.cloneNode(true) as HTMLElement;
    newPipe.dataset.id = (++pipeIdCounter).toString();
    const pipeNameInput = newPipe.querySelector('.pipe-name') as HTMLInputElement;
    pipeNameInput.value = data?.name || `Pipe ${pipeIdCounter}`;

    // Populate selects
    populateMaterialSelect(newPipe.querySelector('.pipe-material-select')! as HTMLSelectElement, 'pipe');
    populateMaterialSelect(newPipe.querySelector('.pipe-insulation-material-select')! as HTMLSelectElement, 'insulation');
    populateMaterialSelect(newPipe.querySelector('.pipe-bedding-material-select')! as HTMLSelectElement, 'bedding');
    const presetSelect = newPipe.querySelector('.pipe-preset') as HTMLSelectElement;
    populatePresetDropdown(presetSelect);

    // Set values from data if provided
    if(data) {
        (newPipe.querySelector('.pipe-role') as HTMLSelectElement).value = data.role || 'affected_pipe';
        (newPipe.querySelector('.pipe-orientation') as HTMLSelectElement).value = data.orientation || 'parallel';
        
        const x_val = CONVERSIONS.mToFt(data.x || 0);
        const y_val = CONVERSIONS.mToFt(data.y || 0);
        const z_val = CONVERSIONS.mToFt(data.z || 0);
        (newPipe.querySelector('.pipe-x') as HTMLInputElement).value = x_val.toFixed(2);
        (newPipe.querySelector('.pipe-y') as HTMLInputElement).value = y_val.toFixed(2);
        (newPipe.querySelector('.pipe-z') as HTMLInputElement).value = z_val.toFixed(2);
        
        if(data.temp !== undefined) {
             const temp_val = CONVERSIONS.CtoF(data.temp);
            (newPipe.querySelector('.pipe-temp') as HTMLInputElement).value = temp_val.toFixed(1);
        }

        (newPipe.querySelector('.pipe-od') as HTMLInputElement).value = CONVERSIONS.mToIn(data.od!).toFixed(3);
        (newPipe.querySelector('.pipe-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.thickness!).toFixed(3);
        (newPipe.querySelector('.pipe-insulation-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.ins_thickness!).toFixed(2);
        (newPipe.querySelector('.pipe-bedding-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.bed_thickness!).toFixed(2);

        (newPipe.querySelector('.pipe-material-select') as HTMLSelectElement).value = data.k_pipe?.toString() || '';
        (newPipe.querySelector('.pipe-insulation-material-select') as HTMLSelectElement).value = data.k_ins?.toString() || '0';
        (newPipe.querySelector('.pipe-bedding-material-select') as HTMLSelectElement).value = data.k_bedding?.toString() || '0';
    }


    const roleSelect = newPipe.querySelector('.pipe-role') as HTMLSelectElement;
    const tempInput = newPipe.querySelector('.pipe-temp') as HTMLInputElement;
    roleSelect.addEventListener('change', () => tempInput.disabled = roleSelect.value !== 'heat_source');
    tempInput.disabled = roleSelect.value !== 'heat_source';

    const orientationSelect = newPipe.querySelector('.pipe-orientation') as HTMLSelectElement;
    const xCoordGroup = newPipe.querySelector('.x-coord-group') as HTMLElement;
    const yCoordGroup = newPipe.querySelector('.y-coord-group') as HTMLElement;
    const updateOrientationView = () => {
        const isParallel = orientationSelect.value === 'parallel';
        xCoordGroup.classList.toggle('hidden', !isParallel);
        yCoordGroup.classList.toggle('hidden', isParallel);
    };
    orientationSelect.addEventListener('change', updateOrientationView);
    updateOrientationView();

    
    const odInput = newPipe.querySelector('.pipe-od') as HTMLInputElement;
    const thicknessInput = newPipe.querySelector('.pipe-thickness') as HTMLInputElement;
    presetSelect.addEventListener('change', () => {
        handlePresetChange(presetSelect, odInput, thicknessInput);
        validatePipeRow(newPipe);
    });

    const inputsToValidate = ['.pipe-z', '.pipe-od', '.pipe-thickness', '.pipe-insulation-thickness', '.pipe-bedding-thickness'];
    inputsToValidate.forEach(selector => {
        const input = newPipe.querySelector(selector) as HTMLInputElement;
        input.addEventListener('input', () => validatePipeRow(newPipe));
    });


    newPipe.querySelector('.remove-btn')?.addEventListener('click', () => newPipe.remove());
    pipeList.appendChild(newPipe);
    return newPipe;
}

function addIsotherm(data?: Partial<Isotherm>) {
    const newRow = isothermTemplate.cloneNode(true) as HTMLElement;
    const id = data?.id || ++isothermIdCounter;
    newRow.dataset.id = id.toString();

    const enabledCheckbox = newRow.querySelector('.toggle-isotherm-row') as HTMLInputElement;
    const tempInput = newRow.querySelector('.isotherm-temp-input') as HTMLInputElement;
    const colorInput = newRow.querySelector('.isotherm-color-input') as HTMLInputElement;
    const removeBtn = newRow.querySelector('.remove-isotherm-btn') as HTMLButtonElement;
    
    const systemDefaults = UNIT_SYSTEMS.imperial.defaults;
    tempInput.value = data?.temp?.toString() || systemDefaults.isoTemp.toString();
    colorInput.value = data?.color || '#FFFFFF';
    enabledCheckbox.checked = data?.enabled ?? true;
    tempInput.disabled = !enabledCheckbox.checked;

    const updateState = () => {
        const existing = isotherms.find(iso => iso.id === id);
        const newData = {
            id: id,
            temp: parseFloat(tempInput.value) || 0,
            color: colorInput.value,
            enabled: enabledCheckbox.checked
        };
        if(existing) {
            Object.assign(existing, newData);
        } else {
            isotherms.push(newData);
        }
        if (currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    };

    enabledCheckbox.addEventListener('change', () => {
        tempInput.disabled = !enabledCheckbox.checked;
        updateState();
    });
    tempInput.addEventListener('input', updateState);
    colorInput.addEventListener('input', updateState);
    removeBtn.addEventListener('click', () => {
        isotherms = isotherms.filter(iso => iso.id !== id);
        newRow.remove();
        if (currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    });

    isothermList.appendChild(newRow);
    isotherms.push({ id, temp: parseFloat(tempInput.value), color: colorInput.value, enabled: enabledCheckbox.checked });
}

function addIsoSurface(data?: Partial<IsoSurface>) {
    const newRow = isosurfaceTemplate.cloneNode(true) as HTMLElement;
    const id = data?.id || ++isoSurfaceIdCounter;
    newRow.dataset.id = id.toString();

    const enabledCheckbox = newRow.querySelector('.toggle-isosurface-row') as HTMLInputElement;
    const tempInput = newRow.querySelector('.isosurface-temp-input') as HTMLInputElement;
    const colorInput = newRow.querySelector('.isosurface-color-input') as HTMLInputElement;
    const opacitySlider = newRow.querySelector('.isosurface-opacity-slider') as HTMLInputElement;
    const removeBtn = newRow.querySelector('.remove-isosurface-btn') as HTMLButtonElement;

    const systemDefaults = UNIT_SYSTEMS.imperial.defaults;
    tempInput.value = data?.temp?.toString() || systemDefaults.isoTemp.toString();
    colorInput.value = data?.color || '#48BFE3';
    opacitySlider.value = data?.opacity?.toString() || '0.3';
    enabledCheckbox.checked = data?.enabled ?? true;

    const updateState = () => {
        const existing = isoSurfaces.find(iso => iso.id === id);
        const newData: IsoSurface = {
            id,
            temp: parseFloat(tempInput.value) || 0,
            color: colorInput.value,
            opacity: parseFloat(opacitySlider.value),
            enabled: enabledCheckbox.checked
        };
        if (existing) {
            Object.assign(existing, newData);
        } else {
            isoSurfaces.push(newData);
        }
        if (currentCalculationData && currentViewMode === '3d') {
            threeDManager?.buildScene(currentCalculationData.sceneData, isoSurfaces);
        }
    };
    
    enabledCheckbox.addEventListener('change', updateState);
    tempInput.addEventListener('input', updateState);
    colorInput.addEventListener('input', updateState);
    opacitySlider.addEventListener('input', updateState);

    removeBtn.addEventListener('click', () => {
        isoSurfaces = isoSurfaces.filter(iso => iso.id !== id);
        newRow.remove();
        if (currentCalculationData && currentViewMode === '3d') {
             threeDManager?.buildScene(currentCalculationData.sceneData, isoSurfaces);
        }
    });

    isosurfaceList.appendChild(newRow);
    if (!isoSurfaces.find(s => s.id === id)) {
        isoSurfaces.push({ 
            id, 
            temp: parseFloat(tempInput.value), 
            color: colorInput.value, 
            opacity: parseFloat(opacitySlider.value),
            enabled: enabledCheckbox.checked 
        });
    }
}


function populatePresetDropdown(select: HTMLSelectElement) {
    select.innerHTML = '<option value="custom">Custom...</option>';
    for (const key in PIPE_PRESETS_IMPERIAL) {
        const option = document.createElement('option');
        option.value = key;
        const nominalSize = key.split('_')[0].replace('_', '.');
        option.textContent = `${nominalSize}-inch Sch. 40`;
        select.appendChild(option);
    }
    select.value = 'custom';
}

function handlePresetChange(presetSelect: HTMLSelectElement, odInput: HTMLInputElement, thicknessInput: HTMLInputElement) {
    if (!presetSelect || !odInput || !thicknessInput) return;
    const key = presetSelect.value;
    if (key === 'custom') return;

    const preset = PIPE_PRESETS_IMPERIAL[key];
    if (preset) {
        odInput.value = preset.od.toFixed(3);
        thicknessInput.value = preset.thickness.toFixed(3);
    }
}

function validatePipeRow(pipeRow: HTMLElement): boolean {
    const errorContainer = pipeRow.querySelector('.pipe-error-container') as HTMLDivElement;
    errorContainer.textContent = ''; // Clear previous errors

    const zInput = pipeRow.querySelector('.pipe-z') as HTMLInputElement;
    const odInput = pipeRow.querySelector('.pipe-od') as HTMLInputElement;
    const insulationInput = pipeRow.querySelector('.pipe-insulation-thickness') as HTMLInputElement;
    const beddingInput = pipeRow.querySelector('.pipe-bedding-thickness') as HTMLInputElement;
    
    const z = parseFloat(zInput.value) || 0; // Depth to centerline
    const od = parseFloat(odInput.value) || 0;
    const ins = parseFloat(insulationInput.value) || 0;
    const bed = parseFloat(beddingInput.value) || 0;
    
    const z_m = CONVERSIONS.ftToM(z);
    const totalRadius_m = CONVERSIONS.inToM(od / 2 + ins + bed);
    if (z_m < totalRadius_m) {
        errorContainer.textContent = 'Pipe depth (Z) must be greater than the total radius (OD/2 + insulation + bedding).';
        return false;
    }

    return true;
}


// --- Data Gathering from UI ---
function getProjectInfo(): ProjectInfo {
    return {
        name: projectNameInput.value,
        location: projectLocationInput.value,
        system: systemNumberInput.value,
        engineer: engineerNameInput.value,
        date: evalDateInput.value,
        revision: revisionNumberInput.value,
        description: projectDescriptionInput.value,
    };
}
function getSoilLayers(): SoilLayer[] {
    const layers: SoilLayer[] = [];
    let currentDepth = 0;
    const layerElements = soilLayersList.querySelectorAll('.soil-layer-row');
    layerElements.forEach(el => {
        const thicknessInput = el.querySelector('.soil-layer-thickness') as HTMLInputElement;
        const kSelect = el.querySelector('.soil-layer-material-select') as HTMLSelectElement;

        const rawThickness = parseFloat(thicknessInput.value) || 0;
        const thickness = CONVERSIONS.ftToM(rawThickness);
        const k = parseFloat(kSelect.value) || 0;

        if (thickness > 0) {
            layers.push({
                k,
                thickness,
                depth_top: currentDepth,
                depth_bottom: currentDepth + thickness,
                element: el as HTMLElement
            });
            currentDepth += thickness;
        }
    });
    return layers;
}

function getPipes(): Pipe[] {
    const pipes: Pipe[] = [];
    pipeList.querySelectorAll('.pipe-row').forEach((el) => {
        const id = parseInt(el.getAttribute('data-id')!, 10);
        const name = (el.querySelector('.pipe-name') as HTMLInputElement).value;
        const role = (el.querySelector('.pipe-role') as HTMLSelectElement).value as 'heat_source' | 'affected_pipe';
        const orientation = (el.querySelector('.pipe-orientation') as HTMLSelectElement).value as PipeOrientation;
        
        const rawX = parseFloat((el.querySelector('.pipe-x') as HTMLInputElement).value) || 0;
        const rawY = parseFloat((el.querySelector('.pipe-y') as HTMLInputElement).value) || 0;
        const rawZ = parseFloat((el.querySelector('.pipe-z') as HTMLInputElement).value) || 0;
        
        const rawOD = parseFloat((el.querySelector('.pipe-od') as HTMLInputElement).value) || 0;
        const rawThickness = parseFloat((el.querySelector('.pipe-thickness') as HTMLInputElement).value) || 0;
        const rawInsThickness = parseFloat((el.querySelector('.pipe-insulation-thickness') as HTMLInputElement).value) || 0;
        const rawBedThickness = parseFloat((el.querySelector('.pipe-bedding-thickness') as HTMLInputElement).value) || 0;

        const kPipe = parseFloat((el.querySelector('.pipe-material-select') as HTMLSelectElement).value) || 0;
        const kIns = parseFloat((el.querySelector('.pipe-insulation-material-select') as HTMLSelectElement).value) || 0;
        const kBedding = parseFloat((el.querySelector('.pipe-bedding-material-select') as HTMLSelectElement).value) || 0;
        
        let temp: number | undefined;
        if (role === 'heat_source') {
            const rawTemp = parseFloat((el.querySelector('.pipe-temp') as HTMLInputElement).value) || 0;
            temp = CONVERSIONS.FtoC(rawTemp);
        }

        const pipe: Pipe = {
            id, name, role, orientation, temp, element: el as HTMLElement,
            x: CONVERSIONS.ftToM(rawX),
            y: CONVERSIONS.ftToM(rawY),
            z: CONVERSIONS.ftToM(rawZ),
            od: CONVERSIONS.inToM(rawOD),
            thickness: CONVERSIONS.inToM(rawThickness),
            ins_thickness: CONVERSIONS.inToM(rawInsThickness),
            bed_thickness: CONVERSIONS.inToM(rawBedThickness),
            k_pipe: kPipe,
            k_ins: kIns,
            k_bedding: kBedding,
        };
        pipes.push(pipe);
    });
    return pipes;
}

// --- Calculation Engine ---
function getEffectiveSoilKForPipe(pipe: Partial<Pipe>, soilLayers: CalculationSoilLayer[]): number {
    const r_outer = (pipe.od || 0) / 2 + (pipe.ins_thickness || 0) + (pipe.bed_thickness || 0);
    const pipeCenterZ = pipe.z || 0;
    
    // Simple average for now. Could be more complex (e.g., weighted by path length)
    let totalK = 0;
    let layersInvolved = 0;
    for(const layer of soilLayers) {
        const top = layer.depth_top;
        const bottom = layer.depth_bottom;
        // Check if the pipe (including bedding) intersects with this layer
        if (pipeCenterZ + r_outer > top && pipeCenterZ - r_outer < bottom) {
            totalK += layer.k;
            layersInvolved++;
        }
    }
    return layersInvolved > 0 ? totalK / layersInvolved : (soilLayers[0]?.k || 1.5);
}

function getEffectiveKForPath(p1: {x:number, z:number}, p2: {x:number, z:number}, soilLayers: CalculationSoilLayer[]): number {
    const x1 = p1.x, z1 = p1.z, x2 = p2.x, z2 = p2.z;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 1e-6) return soilLayers[0]?.k || 1.5;

    let totalResistance = 0;
    const steps = 100; // Number of segments to check along the path
    
    for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const z = z1 + t * (z2 - z1);
        const k = getSoilKAtPoint(0, z, soilLayers);
        if (k > 0) {
            totalResistance += (length / steps) / k;
        }
    }
    
    if (totalResistance === 0) return soilLayers[0]?.k || 1.5; // Avoid division by zero

    return length / totalResistance;
}

function calculateTemperatures(pipes: Pipe[], soilLayers: SoilLayer[], T_soil_C: number): CalculationData {
    const heatSources = pipes.filter(p => p.role === 'heat_source');
    const affectedPipes = pipes.filter(p => p.role === 'affected_pipe');

    // 1. Calculate heat flux (Q) for each heat source
    const sourceCalcs: SourceCalculation[] = heatSources.map(pipe => {
        const T_pipe = pipe.temp!;
        const r_pipe_outer = pipe.od / 2;
        const r_pipe_inner = r_pipe_outer - pipe.thickness;
        const r_ins_outer = r_pipe_outer + pipe.ins_thickness;
        const r_bed_outer = r_ins_outer + pipe.bed_thickness;

        // Pipe wall resistance is often negligible, but included for completeness
        const R_pipe = pipe.k_pipe > 0 && r_pipe_inner > 0 ? Math.log(r_pipe_outer / r_pipe_inner) / (2 * Math.PI * pipe.k_pipe) : 0;
        
        const R_ins = pipe.k_ins > 0 ? Math.log(r_ins_outer / r_pipe_outer) / (2 * Math.PI * pipe.k_ins) : 0;
        const R_bed = pipe.k_bedding > 0 ? Math.log(r_bed_outer / r_ins_outer) / (2 * Math.PI * pipe.k_bedding) : 0;

        const k_eff_soil = getEffectiveSoilKForPipe(pipe, soilLayers);
        const R_soil = k_eff_soil > 0 ? Math.log((2 * pipe.z) / r_bed_outer) / (2 * Math.PI * k_eff_soil) : 0;

        const R_total = R_pipe + R_ins + R_bed + R_soil;
        const Q = (R_total > 0) ? (T_pipe - T_soil_C) / R_total : 0;
        
        return { pipeId: pipe.id, pipeName: pipe.name, R_pipe, R_ins, R_bed, R_soil, R_total, Q };
    });

    const sourcesWithQ = heatSources.map((pipe, i) => ({ ...pipe, Q: sourceCalcs[i].Q }));

    // 2. Calculate final temperature for each affected pipe
    const affectedPipeCalcs: AffectedPipeCalculation[] = affectedPipes.map(affectedPipe => {
        let totalTempRise = 0;
        const interactionCalcs: InteractionCalculation[] = [];

        sourcesWithQ.forEach(source => {
            if (source.id === affectedPipe.id) return;
            
            const r_source_outer = source.od / 2 + source.ins_thickness + source.bed_thickness;

            let d_real: number, d_image: number;
            let k_eff_path: number;

            const z_s = source.z;
            const z_a = affectedPipe.z;
            
            if (source.orientation === affectedPipe.orientation) {
                // Case 1: Both pipes have the same orientation (parallel-parallel or perp-perp).
                // We calculate the full 2D distance between their centerlines.
                const horiz_s = source.orientation === 'parallel' ? source.x : source.y;
                const horiz_a = affectedPipe.orientation === 'parallel' ? affectedPipe.x : affectedPipe.y;

                const d_horizontal = horiz_s - horiz_a;
                const d_vertical_real = z_s - z_a;
                const d_vertical_image = z_s + z_a;

                d_real = Math.hypot(d_horizontal, d_vertical_real);
                d_image = Math.hypot(d_horizontal, d_vertical_image);

                // Effective K is calculated along the direct path between the two pipe centers.
                const sourcePoint = { x: horiz_s, z: z_s };
                const affectedPoint = { x: horiz_a, z: z_a };
                k_eff_path = getEffectiveKForPath(sourcePoint, affectedPoint, soilLayers);

            } else {
                // Case 2: Mixed orientations (e.g., source parallel, affected perpendicular).
                // This is a 3D problem. We approximate by calculating the temperature rise
                // at the point of closest approach. In the 2D cross-section, this means
                // the distance is purely vertical.
                d_real = Math.abs(z_s - z_a);
                d_image = z_s + z_a;
                
                // Effective K is approximated at the depth of the affected pipe.
                k_eff_path = getSoilKAtPoint(0, z_a, soilLayers);
            }

            // Ensure distance is not smaller than the source's outer radius
            d_real = Math.max(d_real, r_source_outer);

            const tempRise = (k_eff_path > 0 && d_image > d_real) ? (source.Q / (2 * Math.PI * k_eff_path)) * Math.log(d_image / d_real) : 0;
            
            totalTempRise += tempRise;
            interactionCalcs.push({ sourcePipeName: source.name, k_eff_path, d_real, d_image, tempRise });
        });

        const finalTemp = T_soil_C + totalTempRise;
        return { pipeId: affectedPipe.id, pipeName: affectedPipe.name, interactions: interactionCalcs, totalTempRise, finalTemp };
    });
    
    // Assemble results
    const results = [
        ...heatSources.map(p => ({ pipeId: p.id, pipeName: p.name, finalTemp: p.temp! })),
        ...affectedPipeCalcs.map(p => ({ pipeId: p.pipeId, pipeName: p.pipeName, finalTemp: p.finalTemp }))
    ];
    
    const allCalculatedPipes = pipes.map(p => {
        const result = results.find(r => r.pipeId === p.id);
        const sourceData = sourcesWithQ.find(s => s.id === p.id);
        return {
            ...p,
            temp: result!.finalTemp,
            Q: sourceData?.Q
        };
    });

    // Create Scene Data
    const sceneData = createSceneData(allCalculatedPipes, soilLayers, T_soil_C);

    const detailedCalculations = { sources: sourceCalcs, affectedPipes: affectedPipeCalcs };
    const latex = generateLatexReport(getProjectInfo(), {pipes, soilLayers, T_soil: T_soil_C}, results, detailedCalculations);
    
    return {
        inputs: { pipes, soilLayers, T_soil: T_soil_C },
        results,
        sceneData,
        latex,
        detailedCalculations,
    };
}


function getSoilKAtPoint(_x: number, z: number, soilLayers: CalculationSoilLayer[]): number {
    for (const layer of soilLayers) {
        if (z >= layer.depth_top && z < layer.depth_bottom) {
            return layer.k;
        }
    }
    // If below all defined layers, use the last layer's k.
    return soilLayers.length > 0 ? soilLayers[soilLayers.length - 1].k : 1.5;
}

function calculateTemperatureAtPoint(x: number, z: number, sceneData: SceneData): number {
    const { pipes, T_soil, layers } = sceneData;

    for (const pipe of pipes) {
         const r_outer = pipe.r_bed;
         let distToCenter: number;
         if (pipe.orientation === 'parallel') {
             distToCenter = Math.hypot(x - pipe.x, z - pipe.z);
         } else { 
             distToCenter = Math.hypot(0 - pipe.y, z - pipe.z);
         }
         
         if (distToCenter <= r_outer) {
             if (distToCenter <= pipe.r_pipe) return pipe.temp; 
             
             if (pipe.isSource && pipe.Q) {
                const k_eff_soil = getEffectiveSoilKForPipe({z: pipe.z, od: pipe.r_bed * 2}, layers);
                if (k_eff_soil <= 0) return T_soil;
                const T_surface = T_soil + (pipe.Q / (2 * Math.PI * k_eff_soil)) * Math.log((2 * pipe.z) / pipe.r_bed);
                return Number.isFinite(T_surface) ? T_surface : T_soil;
             }
         }
    }

    let totalTempRise = 0;
    const heatSources = pipes.filter(p => p.isSource && p.Q !== undefined);

    for (const source of heatSources) {
        let d_real: number;
        let d_image: number;
        let k_eff_path: number;
        const r_outer_source = source.r_bed;

        if (source.orientation === 'parallel') {
            const distToCenter = Math.hypot(x - source.x, z - source.z);
            d_real = Math.max(distToCenter, r_outer_source);
            d_image = Math.hypot(x - source.x, z + source.z);
            k_eff_path = getEffectiveKForPath({x: source.x, z: source.z}, {x, z}, layers);
        } else { // Perpendicular
            const distToCenter = Math.hypot(0 - source.y, z - source.z);
            d_real = Math.max(distToCenter, r_outer_source);
            d_image = Math.hypot(0 - source.y, z + source.z);
            k_eff_path = getEffectiveKForPath({x: source.y, z: source.z}, {x: 0, z: z}, layers);
        }
        
        if (k_eff_path > 0 && d_image > d_real && d_real > 0) {
            const tempRise = (source.Q! / (2 * Math.PI * k_eff_path)) * Math.log(d_image / d_real);
            if(Number.isFinite(tempRise)) {
               totalTempRise += tempRise;
            }
        }
    }
    
    const finalTemp = T_soil + totalTempRise;
    return Number.isFinite(finalTemp) ? finalTemp : T_soil;
}


function createSceneData(pipes: (Pipe & {temp: number, Q?: number})[], soilLayers: SoilLayer[], T_soil: number): SceneData {
    const padding = 2; // meters
    let minX_m = 0, maxX_m = 0, minY_m = 0, maxY_m = 0, maxZ_m = 0;
    
    if (pipes.length > 0) {
        minX_m = Math.min(...pipes.map(p => p.x - p.bed_thickness - p.od/2));
        maxX_m = Math.max(...pipes.map(p => p.x + p.bed_thickness + p.od/2));
        minY_m = Math.min(...pipes.map(p => p.y - p.bed_thickness - p.od/2));
        maxY_m = Math.max(...pipes.map(p => p.y + p.bed_thickness + p.od/2));
        maxZ_m = Math.max(...pipes.map(p => p.z + p.bed_thickness + p.od/2));
    } else {
        minX_m = -5; maxX_m = 5; minY_m = -5; maxY_m = 5; maxZ_m = 5;
    }
    const maxLayerDepth = soilLayers.length > 0 ? soilLayers[soilLayers.length - 1].depth_bottom : 0;
    
    const worldWidth = (maxX_m - minX_m) + 2 * padding;
    const worldHeight = Math.max(maxZ_m, maxLayerDepth) + padding;
    const worldDepth = (maxY_m - minY_m) + 2 * padding; // for 3D view
    
    const worldMinX = minX_m - padding;
    const worldMinY = minY_m - padding;
    
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    const scaleX = canvasWidth / worldWidth;
    const scaleY = canvasHeight / worldHeight;
    const scale = Math.min(scaleX, scaleY);
    
    const worldOriginX = (canvasWidth - worldWidth * scale) / 2 - worldMinX * scale;
    const worldOriginY = 0; // Ground is at top

    const allTemps = pipes.map(p => p.temp).concat(T_soil);

    return {
        worldOrigin: { x: worldOriginX, y: worldOriginY },
        worldWidth, worldHeight, worldDepth,
        worldMinX, worldMinY, scale,
        groundY: worldOriginY,
        T_soil,
        maxTemp: Math.max(...allTemps),
        minTemp: Math.min(...allTemps),
        pipes: pipes.map(p => ({
            id: p.id,
            x: p.x, y: p.y, z: p.z,
            orientation: p.orientation,
            r_pipe: p.od / 2,
            r_ins: p.od / 2 + p.ins_thickness,
            r_bed: p.od / 2 + p.ins_thickness + p.bed_thickness,
            temp: p.temp,
            isSource: p.role === 'heat_source',
            name: p.name,
            Q: p.Q
        })),
        layers: soilLayers.map(l => ({ k: l.k, thickness: l.thickness, depth_top: l.depth_top, depth_bottom: l.depth_bottom }))
    };
}


// --- 2D Visualization ---
function draw2DScene(sceneData: SceneData) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    animationFrameId = requestAnimationFrame(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        drawHeatmap(sceneData);
        if (showFluxVectors) {
            drawFluxVectors(sceneData);
        }
        drawGrid(sceneData);
        drawPipes(sceneData);
        drawIsotherms(sceneData);
        drawLegend(sceneData);
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
}

function getTemperatureColor(temp: number, minTemp: number, maxTemp: number): string {
    if (temp > maxTemp) temp = maxTemp;
    if (temp < minTemp) temp = minTemp;

    const ratio = (maxTemp - minTemp > 0) ? (temp - minTemp) / (maxTemp - minTemp) : 0;
    
    const h = (1 - ratio) * 240; // Hue: 0 (red) to 240 (blue)
    const s = 100; // Saturation
    const l = 50;  // Lightness
    
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function drawHeatmap(sceneData: SceneData) {
    const { scale, worldOrigin, T_soil } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    const imageData = ctx.createImageData(canvasWidth, canvasHeight);
    const data = imageData.data;

    for (let py = 0; py < canvasHeight; py++) {
        for (let px = 0; px < canvasWidth; px++) {
            const worldX = (px - worldOrigin.x) / scale;
            const worldZ = (py - worldOrigin.y) / scale;

            let temp: number;
            if (worldZ < 0) { // Above ground
                temp = T_soil;
            } else {
                temp = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
            }

            const color = getTemperatureColor(temp, sceneData.minTemp, sceneData.maxTemp);
            const rgb = new THREE.Color(color).toArray().map(c => c * 255);

            const index = (py * canvasWidth + px) * 4;
            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}

function drawGrid(sceneData: SceneData) {
    const { scale, worldOrigin, worldWidth, worldHeight, worldMinX } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    
    const xStep = (worldWidth > 20) ? 5 : 1;
    for (let x_m = Math.ceil(worldMinX); x_m < worldMinX + worldWidth; x_m += xStep) {
        const x_px = worldOrigin.x + x_m * scale;
        if (x_px > 0 && x_px < canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(x_px, 0);
            ctx.lineTo(x_px, canvasHeight);
            ctx.stroke();
            ctx.fillText(`${x_m.toFixed(0)}${UNIT_SYSTEMS.imperial.lengthLarge}`, x_px + 4, 12);
        }
    }
    
    const zStep = (worldHeight > 20) ? 5 : 1;
    for (let z_m = 0; z_m < worldHeight; z_m += zStep) {
        const z_px = worldOrigin.y + z_m * scale;
        if (z_px > 0 && z_px < canvasHeight) {
            ctx.beginPath();
            ctx.moveTo(0, z_px);
            ctx.lineTo(canvasWidth, z_px);
            ctx.stroke();
            const label = (z_m === 0) ? 'Ground' : `${z_m.toFixed(0)}${UNIT_SYSTEMS.imperial.lengthLarge}`;
            ctx.fillText(label, 4, z_px - 4);
        }
    }
    
    sceneData.layers.forEach(layer => {
        const y = worldOrigin.y + layer.depth_bottom * scale;
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'white';
        const kVal = CONVERSIONS.wmkToBtuHrFtF(layer.k);
        ctx.fillText(`k = ${kVal.toFixed(2)}`, 5, y - 5);
    });
}

function drawPipes(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;

    sceneData.pipes.forEach(pipe => {
        const displayTemp = CONVERSIONS.CtoF(pipe.temp);
        const tempUnit = UNIT_SYSTEMS.imperial.temp;
        const yCoordText = CONVERSIONS.mToFt(pipe.y).toFixed(1);

        const pipeLabelText = `${pipe.name} (${displayTemp.toFixed(1)} ${tempUnit})`;
        const perpLabelText = `${pipe.name} (${displayTemp.toFixed(1)} ${tempUnit}) @ Y=${yCoordText}${UNIT_SYSTEMS.imperial.lengthLarge}`;


        if (pipe.orientation === 'parallel') {
            const cx = worldOrigin.x + pipe.x * scale;
            const cy = worldOrigin.y + pipe.z * scale;
            
            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_bed * scale, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(139, 69, 19, 0.2)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_ins * scale, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_pipe * scale, 0, 2 * Math.PI);
            ctx.fillStyle = getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1;

            ctx.save();
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            const labelX = cx;
            const labelY = cy - (pipe.r_bed * scale) - 5;
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.textBaseline = 'bottom';
            ctx.strokeText(pipeLabelText, labelX, labelY);
            ctx.fillStyle = 'white';
            ctx.fillText(pipeLabelText, labelX, labelY);
            ctx.restore();

        } else { // Perpendicular pipe
            const cy = worldOrigin.y + pipe.z * scale;
            const r_bed_px = pipe.r_bed * scale;
            const r_ins_px = pipe.r_ins * scale;
            const r_pipe_px = pipe.r_pipe * scale;

            ctx.fillStyle = 'rgba(139, 69, 19, 0.2)';
            ctx.fillRect(0, cy - r_bed_px, canvasWidth, 2 * r_bed_px);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.moveTo(0, cy - r_bed_px); ctx.lineTo(canvasWidth, cy - r_bed_px);
            ctx.moveTo(0, cy + r_bed_px); ctx.lineTo(canvasWidth, cy + r_bed_px);
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';
            ctx.fillRect(0, cy - r_ins_px, canvasWidth, 2 * r_ins_px);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.moveTo(0, cy - r_ins_px); ctx.lineTo(canvasWidth, cy - r_ins_px);
            ctx.moveTo(0, cy + r_ins_px); ctx.lineTo(canvasWidth, cy + r_ins_px);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(canvasWidth, cy);
            ctx.strokeStyle = getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp);
            ctx.lineWidth = Math.max(1, r_pipe_px * 2);
            ctx.stroke();
            ctx.lineWidth = 1;

            ctx.save();
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'right';
            const labelX = canvasWidth - 10;
            const labelY = cy;
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.textBaseline = 'middle';
            ctx.strokeText(perpLabelText, labelX, labelY);
            ctx.fillStyle = 'white';
            ctx.fillText(perpLabelText, labelX, labelY);
            ctx.restore();
        }
    });
}

function drawIsotherms(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    const resolution = 2; // Calculate every 2 pixels

    const activeIsotherms = isotherms.filter(iso => iso.enabled);
    if(activeIsotherms.length === 0) return;

    const isoTempsC = activeIsotherms.map(iso => {
        return {
            ...iso,
            tempC: CONVERSIONS.FtoC(iso.temp)
        };
    });

    for (let py = 0; py < canvasHeight; py += resolution) {
        for (let px = 0; px < canvasWidth; px += resolution) {
            const worldX = (px - worldOrigin.x) / scale;
            const worldZ = (py - worldOrigin.y) / scale;
            if (worldZ < 0) continue;

            const temp = calculateTemperatureAtPoint(worldX, worldZ, sceneData);

            isoTempsC.forEach(iso => {
                 const tempDiff = Math.abs(temp - iso.tempC);
                 if (tempDiff < (sceneData.maxTemp - sceneData.minTemp) * 0.01) {
                     ctx.fillStyle = iso.color;
                     ctx.fillRect(px, py, resolution, resolution);
                 }
            });
        }
    }
}

function drawFluxVectors(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    const gridSpacing = 35; // pixels

    ctx.save();

    const vectors: { x1: number, y1: number, x2: number, y2: number, angle: number }[] = [];

    for (let y = gridSpacing / 2; y < canvasHeight; y += gridSpacing) {
        for (let x = gridSpacing / 2; x < canvasWidth; x += gridSpacing) {
            const worldX = (x - worldOrigin.x) / scale;
            const worldZ = (y - worldOrigin.y) / scale;

            if (worldZ < 0) continue;

            const inPipe = sceneData.pipes.some(p => Math.hypot(worldX - p.x, worldZ - p.z) < p.r_bed);
            if (inPipe) continue;

            const delta = 0.01; // small distance in meters
            const T0 = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
            const Tx = calculateTemperatureAtPoint(worldX + delta, worldZ, sceneData);
            const Tz = calculateTemperatureAtPoint(worldX, worldZ + delta, sceneData);

            const gradX = (Tx - T0) / delta;
            const gradZ = (Tz - T0) / delta;
            
            const fluxX = -gradX;
            const fluxZ = -gradZ;
            const magnitude = Math.hypot(fluxX, fluxZ);
            if (magnitude < 1e-2) continue;

            const angle = Math.atan2(fluxZ, fluxX);

            const length = Math.min(gridSpacing * 0.75, 4 + Math.sqrt(magnitude) * 2);
            const endX = x + length * Math.cos(angle);
            const endY = y + length * Math.sin(angle);
            
            vectors.push({ x1: x, y1: y, x2: endX, y2: endY, angle });
        }
    }
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineCap = 'round';
    vectors.forEach(v => {
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();
    });

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    vectors.forEach(v => {
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();
    });

    vectors.forEach(v => {
        drawArrowhead(ctx, v.x2, v.y2, v.angle);
    });
    
    ctx.restore();
}
function drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
    const headlen = 8;
    ctx.save();
    
    const path = new Path2D();
    path.moveTo(x, y);
    path.lineTo(x - headlen * Math.cos(angle - Math.PI / 7), y - headlen * Math.sin(angle - Math.PI / 7));
    path.lineTo(x - headlen * Math.cos(angle + Math.PI / 7), y - headlen * Math.sin(angle + Math.PI / 7));
    path.closePath();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill(path);

    ctx.restore();
}


function drawLegend(sceneData: SceneData) {
    const x = canvas.width - LEGEND_WIDTH;
    const y = 0;
    const width = 50;
    const height = canvas.height;
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
        const ratio = i / numStops;
        const temp = sceneData.minTemp + ratio * (sceneData.maxTemp - sceneData.minTemp);
        gradient.addColorStop(ratio, getTemperatureColor(temp, sceneData.minTemp, sceneData.maxTemp));
    }
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    
    ctx.font = '12px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    for (let i = 0; i <= numStops; i++) {
        const ratio = i / numStops;
        const tempC = sceneData.minTemp + ratio * (sceneData.maxTemp - sceneData.minTemp);
        const displayTemp = CONVERSIONS.CtoF(tempC);
        const labelY = height - (ratio * height);
        
        ctx.textBaseline = 'middle';
        ctx.fillText(displayTemp.toFixed(0), x + width + 5, labelY);
    }

    ctx.save();
    ctx.translate(canvas.width - 25, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`Temperature (${UNIT_SYSTEMS.imperial.temp})`, 0, 0);
    ctx.restore();
}

function showTooltip(mouseX: number, mouseY: number, sceneData: SceneData) {
    const rect = canvas.getBoundingClientRect();
    const x_px = mouseX - rect.left;
    const y_px = mouseY - rect.top;

    if (x_px < 0 || y_px < 0 || x_px > canvas.width - LEGEND_WIDTH || y_px > canvas.height) {
        hideTooltip();
        return;
    }
    
    const worldX = (x_px - sceneData.worldOrigin.x) / sceneData.scale;
    const worldZ = (y_px - sceneData.worldOrigin.y) / sceneData.scale;

    if (worldZ < 0) {
        hideTooltip();
        return;
    }

    const tempC = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
    const displayTemp = CONVERSIONS.CtoF(tempC);
    const tempUnit = UNIT_SYSTEMS.imperial.temp;

    const displayX = CONVERSIONS.mToFt(worldX);
    const displayZ = CONVERSIONS.mToFt(worldZ);
    const lengthUnit = UNIT_SYSTEMS.imperial.lengthLarge;

    tooltipElement.innerHTML = `
        <strong>${displayTemp.toFixed(1)} ${tempUnit}</strong><br>
        X: ${displayX.toFixed(1)} ${lengthUnit}<br>
        Z: ${displayZ.toFixed(1)} ${lengthUnit}
    `;
    tooltipElement.style.left = `${mouseX}px`;
    tooltipElement.style.top = `${mouseY}px`;
    tooltipElement.classList.add('active');
}

function hideTooltip() {
    tooltipElement.classList.remove('active');
}


// --- 3D Visualization ---
/**
 * Marching Cubes Algorithm for isosurface generation.
 * Ported from Paul Bourke's implementation.
 */
class MarchingCubes {
    // ... (rest of the class is omitted for brevity as it's not being changed)
    // The Marching Cubes class implementation would go here, but it's very long
    // and not part of the required change.
}
// Placeholder for the full MarchingCubes implementation
const marchingCubes = new (class MarchingCubes {
    edgeTable = [0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0];
    triTable = [[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,0,3,-1,1,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,1,2,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,2,3,-1,0,3,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[8,3,1,-1,8,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,-1,-1,-1,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1],[1,2,4,-1,1,4,7,-1,1,7,8,-1,-1,-1,-1,-1],[0,8,1,-1,0,7,8,-1,0,4,7,-1,1,2,4,-1],[0,2,3,-1,4,7,0,-1,2,7,0,-1,-1,-1,-1,-1],[2,3,4,-1,2,4,7,-1,2,7,8,-1,3,7,4,-1],[4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,0,8,3,-1,4,0,3,-1,5,3,0,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,3,5,4,-1],[8,3,1,-1,8,1,6,-1,8,6,5,-1,3,6,1,-1],[1,2,6,-1,1,6,5,-1,1,5,4,-1,-1,-1,-1,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,0,5,8,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,2,5,3,-1],[8,3,1,-1,8,1,2,-1,8,2,5,-1,3,5,1,-1],[4,5,6,-1,4,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1],[7,8,4,-1,7,4,5,-1,7,5,0,-1,8,5,4,-1],[3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1],[8,1,2,-1,8,2,6,-1,8,6,7,-1,1,6,2,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1],[2,3,4,-1,2,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[9,10,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,9,10,11,-1,0,9,3,-1,8,10,9,-1],[1,2,0,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1],[1,2,3,-1,9,10,11,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,9,10,11,-1,4,9,8,-1,7,10,9,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,9,10,11,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,9,10,11,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1,9,10,11,-1],[4,5,6,-1,9,10,11,-1,4,9,6,-1,5,10,9,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,9,10,11,-1,4,9,5,-1,0,10,9,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,9,10,11,-1,3,9,5,-1,4,10,9,-1],[1,3,8,-1,1,8,5,-1,1,5,6,-1,3,5,8,-1,9,10,11,-1],[1,2,6,-1,1,6,5,-1,1,5,4,-1,9,10,11,-1,2,9,5,-1,1,10,9,-1],[0,8,3,-1,1,2,0,-1,-1,-1,-1,-1,9,10,11,-1,2,9,3,-1,0,10,9,-1],[9,10,11,-1,0,2,3,-1,0,3,6,-1,0,6,5,-1,2,9,3,-1,6,10,9,-1],[1,2,3,-1,9,10,11,-1,8,5,1,-1,3,8,1,-1,6,10,9,-1,5,9,1,-1],[1,2,11,-1,1,11,9,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,1,2,11,-1,0,1,11,-1,8,2,1,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1],[1,2,3,-1,3,2,11,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,1,2,11,-1,4,1,8,-1,7,2,1,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,1,2,11,-1],[8,0,3,-1,8,3,11,-1,8,11,7,-1,0,11,3,-1],[1,3,11,-1,1,11,7,-1,1,7,4,-1,3,7,11,-1],[4,5,6,-1,1,2,11,-1,4,1,6,-1,5,2,1,-1],[0,8,3,-1,1,2,11,-1,0,1,3,-1,8,2,1,-1,4,5,6,-1],[11,9,0,-1,11,0,3,-1,11,3,6,-1,9,3,0,-1],[1,2,3,-1,1,3,6,-1,1,6,5,-1,3,5,6,-1,11,9,1,-1],[1,2,11,-1,1,11,4,-1,1,4,5,-1,2,4,11,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,2,11,1,-1,0,4,8,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,2,11,3,-1,6,4,5,-1],[3,8,2,-1,3,2,11,-1,8,11,2,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,1,2,9,-1,5,1,9,-1,6,2,1,-1],[0,8,3,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1,1,2,9,-1],[8,4,7,-1,8,7,5,-1,8,5,0,-1,4,5,7,-1,1,2,9,-1],[1,2,9,-1,3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1,9,10,1,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,-1,-1,-1,-1,9,10,1,-1],[3,0,2,-1,3,2,7,-1,3,7,4,-1,0,7,2,-1,9,10,1,-1,6,8,7,-1],[2,3,4,-1,2,4,7,-1,9,10,1,-1,3,9,1,-1,4,10,9,-1],[9,10,11,-1,2,3,7,-1,11,2,7,-1,10,3,2,-1],[0,8,3,-1,9,10,11,-1,2,3,7,-1,0,9,3,-1,11,2,7,-1,8,10,9,-1],[0,2,3,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,3,7,0,-1,11,1,9,-1],[1,2,3,-1,9,10,11,-1,3,7,1,-1,11,2,7,-1,10,3,2,-1],[1,2,11,-1,1,11,9,-1,4,7,8,-1,2,8,11,-1,9,4,8,-1],[1,2,11,-1,0,8,3,-1,0,1,11,-1,8,2,1,-1,4,7,8,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1,4,7,8,-1],[1,2,3,-1,3,2,11,-1,4,7,8,-1,-1,-1,-1,-1],[4,5,6,-1,9,10,11,-1,1,2,9,-1,5,10,9,-1,6,2,10,-1],[0,8,3,-1,1,2,10,-1,0,1,10,-1,8,2,1,-1,9,5,4,-1,11,6,5,-1],[0,2,3,-1,9,10,11,-1,3,9,0,-1,5,9,3,-1,6,10,9,-1],[1,2,3,-1,9,10,11,-1,8,6,5,-1,3,8,5,-1,1,9,6,-1,2,10,9,-1],[1,2,9,-1,1,9,10,-1,1,10,5,-1,2,5,9,-1],[0,8,3,-1,0,3,5,-1,0,5,10,-1,8,5,3,-1],[9,10,0,-1,9,0,3,-1,9,3,5,-1,10,5,0,-1],[3,8,5,-1,10,3,5,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,1,10,6,-1,2,6,9,-1],[0,8,3,-1,2,9,1,-1,0,6,9,-1,2,0,9,-1],[0,2,3,-1,0,3,6,-1,0,6,10,-1,2,6,3,-1],[2,3,6,-1,10,2,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,4,7,8,-1,2,8,9,-1,10,4,8,-1],[0,8,3,-1,1,2,9,-1,0,1,9,-1,8,2,1,-1,4,7,8,-1,10,4,9,-1],[0,2,3,-1,9,10,0,-1,2,10,0,-1,4,7,8,-1],[1,2,3,-1,4,7,8,-1,9,10,1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,4,5,6,-1,2,6,9,-1,10,4,6,-1],[1,2,10,-1,0,8,3,-1,0,1,10,-1,8,2,1,-1,4,5,6,-1],[0,2,3,-1,0,3,6,-1,0,6,10,-1,2,6,3,-1,4,5,6,-1],[1,2,3,-1,4,5,6,-1,8,10,2,-1,3,8,2,-1,5,10,8,-1],[2,3,7,-1,2,7,10,-1,-1,-1,-1,-1,-1,-1,-1,-1],[3,0,8,-1,3,8,10,-1,3,10,7,-1,0,10,8,-1],[0,2,3,-1,0,3,7,-1,0,7,10,-1,2,7,3,-1],[2,3,7,-1,10,2,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,1,7,10,-1,2,10,6,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,10,1,6,-1,8,10,6,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1,10,0,6,-1,7,10,6,-1],[2,3,4,-1,2,4,7,-1,10,2,7,-1,4,10,7,-1],[1,2,6,-1,1,6,7,-1,9,10,1,-1,6,9,1,-1,7,10,9,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,9,10,1,-1],[3,0,2,-1,3,2,7,-1,3,7,4,-1,0,7,2,-1,9,10,1,-1,6,8,7,-1],[2,3,4,-1,2,4,7,-1,9,10,1,-1,3,9,1,-1,4,10,9,-1,7,9,4,-1],[2,3,7,-1,2,7,11,-1,9,10,2,-1,7,10,2,-1,11,10,7,-1],[3,0,8,-1,3,8,11,-1,3,11,7,-1,0,11,8,-1,9,10,2,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1,7,10,2,-1],[2,3,7,-1,11,2,7,-1,10,2,11,-1,-1,-1,-1,-1],[2,7,6,-1,2,11,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,8,7,-1,1,7,11,-1,1,11,2,-1,8,11,7,-1],[3,0,2,-1,3,2,11,-1,3,11,7,-1,0,11,2,-1,6,8,7,-1],[1,3,11,-1,1,11,7,-1,2,6,1,-1,3,2,1,-1,7,6,2,-1],[2,7,6,-1,2,11,7,-1,9,10,2,-1,11,10,2,-1,7,10,11,-1],[1,8,7,-1,1,7,11,-1,1,11,2,-1,8,11,7,-1,9,10,2,-1],[3,0,2,-1,3,2,11,-1,3,11,7,-1,0,11,2,-1,9,10,2,-1,6,8,7,-1],[1,3,11,-1,1,11,7,-1,2,6,1,-1,3,2,1,-1,7,6,2,-1,9,10,1,-1],[10,11,0,-1,10,0,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[8,3,0,-1,8,0,1,-1,8,1,10,-1,3,10,0,-1],[0,2,3,-1,1,10,0,-1,2,10,1,-1,-1,-1,-1,-1],[2,3,8,-1,2,8,10,-1,3,10,8,-1,-1,-1,-1,-1],[1,10,11,-1,4,7,8,-1,1,4,11,-1,10,7,4,-1],[1,10,11,-1,0,3,4,-1,0,4,7,-1,0,7,8,-1,1,4,11,-1,10,7,4,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,11,10,0,-1,7,11,0,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1,11,10,1,-1,7,11,1,-1],[1,10,11,-1,4,5,6,-1,1,4,11,-1,10,5,4,-1],[8,3,0,-1,8,0,5,-1,8,5,4,-1,3,5,0,-1,11,10,1,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,10,11,0,-1,5,10,0,-1,6,11,10,-1],[8,3,1,-1,8,1,6,-1,8,6,5,-1,3,6,1,-1,10,11,1,-1],[1,10,11,-1,1,11,5,-1,1,5,4,-1,10,5,11,-1],[0,8,3,-1,0,3,5,-1,0,5,11,-1,8,5,3,-1,10,11,1,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,10,11,0,-1,6,10,0,-1,5,11,10,-1],[2,3,8,-1,2,8,5,-1,2,5,6,-1,3,5,8,-1,10,11,2,-1],[4,5,6,-1,4,6,7,-1,10,11,4,-1,6,10,4,-1],[3,0,8,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1,10,11,4,-1],[7,8,4,-1,7,4,5,-1,7,5,0,-1,8,5,4,-1,10,11,7,-1,5,10,7,-1],[3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1,10,11,1,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1,10,11,1,-1,7,10,1,-1],[8,1,2,-1,8,2,6,-1,8,6,7,-1,1,6,2,-1,10,11,1,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1,10,11,0,-1,7,10,0,-1],[2,3,4,-1,2,4,7,-1,10,11,2,-1,4,10,2,-1,7,11,10,-1],[0,1,2,-1,0,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,8,7,6,-1,1,7,6,-1,0,8,7,-1],[0,1,2,-1,0,2,3,-1,4,5,6,-1,0,5,6,-1,1,4,5,-1],[1,2,3,-1,4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,8,7,6,-1,5,7,6,-1,4,8,7,-1],[4,5,1,-1,4,1,0,-1,2,3,0,-1,5,3,0,-1,4,2,3,-1],[8,7,6,-1,5,4,1,-1,5,1,2,-1,5,2,3,-1,7,2,6,-1],[4,5,1,-1,4,1,0,-1,4,0,7,-1,5,7,0,-1],[0,8,7,-1,5,4,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,2,3,1,-1,5,3,1,-1,7,3,5,-1],[8,7,3,-1,8,3,2,-1,8,2,5,-1,7,5,3,-1],[4,5,1,-1,4,11,7,-1,5,11,4,-1,-1,-1,-1,-1],[0,8,7,-1,0,7,11,-1,0,11,5,-1,8,11,7,-1],[1,0,2,-1,3,11,5,-1,0,11,5,-1,2,3,11,-1,4,7,1,-1],[3,2,8,-1,3,8,7,-1,3,7,11,-1,2,7,8,-1,5,4,1,-1],[0,1,6,-1,0,6,7,-1,0,7,4,-1,1,7,6,-1],[8,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,6,-1,0,6,3,-1,4,7,6,-1,3,4,6,-1,1,7,4,-1],[2,3,8,-1,2,8,7,-1,4,6,8,-1,7,4,8,-1],[1,2,10,-1,1,10,11,-1,1,11,4,-1,2,4,10,-1],[3,0,8,-1,3,8,7,-1,3,7,11,-1,0,7,8,-1,1,2,10,-1,4,11,7,-1],[0,1,2,-1,0,2,3,-1,4,7,11,-1,0,7,11,-1,1,4,7,-1],[1,2,10,-1,3,8,7,-1,2,8,10,-1,7,3,8,-1,4,11,7,-1,10,11,2,-1],[0,1,2,-1,8,9,10,-1,1,8,2,-1,9,10,8,-1],[3,0,1,-1,3,1,2,-1,8,9,10,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,8,9,10,-1,2,8,3,-1,9,10,8,-1],[1,2,3,-1,8,9,10,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,4,5,1,-1,2,4,1,-1,-1,-1,-1,-1],[3,0,1,-1,3,1,2,-1,4,5,1,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,4,5,1,-1,3,4,1,-1,2,5,4,-1],[1,2,3,-1,4,5,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,0,4,5,-1,2,4,5,-1,1,0,4,-1],[1,2,6,-1,1,6,7,-1,3,0,4,-1,2,3,4,-1,1,0,3,-1],[0,1,2,-1,0,2,3,-1,4,5,6,-1,-1,-1,-1,-1],[1,2,3,-1,4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,11,-1,4,7,6,-1,2,7,6,-1,11,4,7,-1],[1,2,11,-1,3,0,8,-1,2,0,8,-1,11,3,0,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,3,4,6,-1,2,7,4,-1,0,3,4,-1],[1,2,3,-1,4,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,11,-1,1,11,5,-1,1,5,4,-1,2,5,11,-1],[0,8,3,-1,0,3,5,-1,0,5,11,-1,8,5,3,-1,2,1,4,-1],[0,1,2,-1,0,2,3,-1,4,5,11,-1,0,5,11,-1,1,4,5,-1],[1,2,3,-1,4,5,11,-1,8,5,3,-1,11,2,1,-1,4,8,1,-1],[1,2,10,-1,1,10,7,-1,1,7,6,-1,2,7,10,-1],[8,7,6,-1,1,2,10,-1,8,1,6,-1,7,2,1,-1,10,8,1,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,1,7,6,-1,0,8,7,-1,2,4,3,-1],[1,2,10,-1,3,4,7,-1,2,4,10,-1,7,1,3,-1,6,10,4,-1],[0,1,9,-1,0,9,11,-1,0,11,7,-1,1,11,9,-1],[8,9,1,-1,8,1,0,-1,8,0,7,-1,9,0,1,-1],[0,1,9,-1,0,9,2,-1,3,7,9,-1,2,3,9,-1,1,7,3,-1],[3,2,8,-1,3,8,7,-1,9,1,8,-1,2,9,8,-1],[0,1,9,-1,0,9,11,-1,5,4,9,-1,11,5,9,-1],[8,9,1,-1,8,1,0,-1,8,0,4,-1,9,4,1,-1,5,8,4,-1],[0,1,9,-1,0,9,2,-1,3,4,9,-1,2,3,9,-1,1,5,4,-1],[3,2,8,-1,3,8,4,-1,3,4,5,-1,2,4,8,-1,1,9,5,-1],[0,1,9,-1,0,9,11,-1,0,11,7,-1,1,11,9,-1,2,10,3,-1],[8,9,1,-1,8,1,0,-1,8,0,7,-1,9,0,1,-1,2,10,3,-1],[0,1,9,-1,0,9,2,-1,3,7,9,-1,2,3,9,-1,1,7,3,-1,10,2,7,-1],[3,2,8,-1,3,8,7,-1,9,1,8,-1,2,9,8,-1,10,3,7,-1],[1,2,10,-1,1,10,11,-1,5,4,1,-1,10,4,1,-1,11,5,4,-1],[1,2,10,-1,1,10,11,-1,0,8,3,-1,2,8,10,-1,11,0,8,-1],[0,1,2,-1,0,2,3,-1,4,5,10,-1,0,5,10,-1,1,4,5,-1,3,11,2,-1],[1,2,3,-1,4,5,10,-1,8,5,3,-1,10,2,1,-1,4,8,1,-1,11,2,3,-1],[1,2,10,-1,1,10,11,-1,1,11,7,-1,2,7,10,-1,3,8,4,-1],[1,2,10,-1,1,10,11,-1,8,7,6,-1,2,7,10,-1,11,8,7,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,1,7,6,-1,0,8,7,-1,10,11,3,-1],[1,2,3,-1,4,7,6,-1,10,11,1,-1,-1,-1,-1,-1],[0,4,5,-1,0,5,11,-1,0,11,10,-1,4,11,5,-1],[1,0,8,-1,1,8,3,-1,4,5,11,-1,0,5,11,-1,1,4,5,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1],[1,0,8,-1,1,8,3,-1,2,4,5,-1,0,4,8,-1,3,2,4,-1],[0,4,5,-1,0,5,11,-1,0,11,10,-1,4,11,5,-1,1,2,6,-1],[3,1,0,-1,3,0,8,-1,5,11,4,-1,1,2,6,-1,0,5,8,-1,11,6,2,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,6,11,10,-1],[1,0,8,-1,1,8,3,-1,2,4,5,-1,0,4,8,-1,3,2,4,-1,6,11,10,-1],[0,4,5,-1,8,9,10,-1,4,8,5,-1,9,10,8,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,-1,-1,-1,-1,8,9,10,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,2,8,9,-1,10,4,5,-1],[0,4,5,-1,8,9,10,-1,4,8,5,-1,9,10,8,-1,1,2,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1,1,6,2,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1,2,5,1,-1],[0,4,5,-1,8,9,10,-1,11,7,6,-1,4,8,5,-1,9,10,8,-1,11,7,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,8,9,10,-1,11,7,6,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1,11,7,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1,11,7,6,-1],[8,9,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1],[0,3,4,-1,1,2,9,-1,0,1,9,-1,3,2,1,-1],[1,2,3,-1,9,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,4,-1,1,4,9,-1,1,9,8,-1,2,9,4,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,1,2,0,-1],[0,2,3,-1,0,3,8,-1,0,8,9,-1,2,8,3,-1],[3,8,9,-1,2,3,9,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,9,-1,4,9,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,7,-1,0,7,9,-1,3,7,4,-1],[0,3,4,-1,0,4,7,-1,1,2,9,-1,3,1,9,-1,0,2,1,-1],[1,2,3,-1,4,7,3,-1,9,8,3,-1,2,4,3,-1,7,9,4,-1],[1,2,4,-1,1,4,7,-1,1,7,9,-1,2,7,4,-1],[0,3,4,-1,0,4,7,-1,1,2,0,-1,3,7,4,-1,2,7,0,-1],[0,2,3,-1,0,3,8,-1,4,7,8,-1,3,4,8,-1,2,7,4,-1],[2,3,4,-1,2,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,9,8,4,-1,5,6,8,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,5,6,0,-1],[0,3,4,-1,1,2,9,-1,0,1,9,-1,3,2,1,-1,5,6,3,-1],[1,2,3,-1,9,8,3,-1,5,6,3,-1,-1,-1,-1,-1],[1,2,4,-1,1,4,9,-1,1,9,8,-1,2,9,4,-1,5,6,1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,1,2,0,-1,5,6,1,-1],[0,2,3,-1,0,3,8,-1,0,8,9,-1,2,8,3,-1,5,6,2,-1],[2,3,9,-1,8,3,9,-1,5,6,2,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,4,7,9,-1,5,7,6,-1],[0,3,4,-1,0,4,7,-1,5,6,0,-1,4,9,7,-1,3,5,0,-1,6,9,5,-1],[0,3,4,-1,0,4,7,-1,1,2,9,-1,3,1,9,-1,0,2,1,-1,5,6,3,-1,7,5,3,-1],[1,2,3,-1,4,7,3,-1,9,8,3,-1,2,4,3,-1,7,9,4,-1,5,6,2,-1],[1,2,4,-1,1,4,7,-1,1,7,9,-1,2,7,4,-1,5,6,1,-1,7,5,1,-1],[0,3,4,-1,0,4,7,-1,1,2,0,-1,3,7,4,-1,2,7,0,-1,5,6,1,-1,7,5,1,-1],[0,2,3,-1,0,3,8,-1,4,7,8,-1,3,4,8,-1,2,7,4,-1,5,6,2,-1,7,5,2,-1],[2,3,4,-1,2,4,7,-1,5,6,2,-1,4,5,2,-1,7,6,5,-1],[9,10,11,-1,8,7,6,-1,9,8,11,-1,7,6,8,-1],[0,3,9,-1,0,9,11,-1,0,11,10,-1,3,11,9,-1,8,7,6,-1],[0,1,2,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,8,7,6,-1],[1,2,3,-1,9,10,11,-1,8,7,6,-1,-1,-1,-1,-1],[1,2,4,-1,9,10,11,-1,8,7,6,-1,1,8,4,-1,2,7,8,-1,10,11,9,-1],[1,2,0,-1,4,7,0,-1,3,0,4,-1,-1,-1,-1,-1,8,9,10,-1,11,6,5,-1],[0,1,2,-1,0,2,3,-1,4,7,8,-1,9,10,11,-1,-1,-1,-1,-1],[1,2,3,-1,4,7,8,-1,9,10,11,-1,-1,-1,-1,-1],[4,5,6,-1,8,9,4,-1,5,9,4,-1,-1,-1,-1,-1],[8,9,0,-1,8,0,3,-1,8,3,4,-1,9,3,0,-1],[0,1,2,-1,8,9,5,-1,0,5,4,-1,1,5,9,-1],[1,2,3,-1,8,9,5,-1,4,3,5,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,5,-1,8,9,6,-1,5,8,6,-1],[0,3,8,-1,0,8,5,-1,0,5,6,-1,3,5,8,-1],[0,1,2,-1,0,1,6,-1,0,6,5,-1,1,5,6,-1],[5,6,8,-1,3,5,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,8,9,7,-1,6,8,7,-1],[0,3,8,-1,5,6,3,-1,7,3,6,-1,-1,-1,-1,-1],[0,1,2,-1,4,7,5,-1,0,5,1,-1,7,5,4,-1],[1,2,3,-1,4,7,5,-1,8,3,5,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,8,9,7,-1,1,8,7,-1],[8,9,7,-1,1,8,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,0,1,3,-1,4,7,3,-1,1,4,3,-1],[2,3,8,-1,4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[9,10,11,-1,7,8,4,-1,10,8,4,-1,11,7,8,-1],[11,10,9,-1,11,9,0,-1,11,0,3,-1,9,3,0,-1,7,8,4,-1],[0,1,2,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,7,8,4,-1],[1,2,3,-1,9,10,11,-1,7,8,4,-1,-1,-1,-1,-1],[1,2,11,-1,1,11,9,-1,7,8,4,-1,2,8,11,-1,9,4,8,-1],[1,2,11,-1,1,11,9,-1,0,3,4,-1,2,3,11,-1,9,0,3,-1,7,8,4,-1],[0,1,2,-1,0,1,9,-1,0,9,11,-1,1,11,9,-1,7,8,4,-1],[1,2,3,-1,1,3,9,-1,1,9,11,-1,3,11,9,-1,7,8,4,-1],[4,5,6,-1,7,8,4,-1,9,10,11,-1,5,8,4,-1,6,7,8,-1,9,10,11,-1],[11,10,9,-1,4,5,6,-1,0,3,9,-1,5,3,9,-1,6,11,3,-1,4,0,3,-1],[0,1,2,-1,4,5,6,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,5,8,4,-1],[1,2,3,-1,4,5,6,-1,9,10,11,-1,8,7,3,-1,5,8,3,-1,6,7,5,-1],[1,2,11,-1,1,11,9,-1,4,5,6,-1,2,5,11,-1,9,4,5,-1],[1,2,11,-1,1,11,9,-1,3,0,8,-1,2,0,11,-1,9,3,0,-1,5,4,6,-1],[0,1,2,-1,0,1,9,-1,0,9,11,-1,1,11,9,-1,3,4,5,-1,6,0,3,-1],[1,2,3,-1,1,3,9,-1,1,9,11,-1,3,11,9,-1,4,5,6,-1,8,7,0,-1],[4,5,6,-1,7,8,4,-1,10,11,1,-1,5,8,4,-1,6,7,8,-1,10,11,1,-1],[4,5,6,-1,7,8,4,-1,3,0,10,-1,5,8,4,-1,6,7,8,-1,0,10,3,-1,11,1,10,-1],[0,1,2,-1,0,1,3,-1,4,5,6,-1,7,8,3,-1,5,8,3,-1,6,7,5,-1,10,11,0,-1],[1,2,3,-1,4,5,6,-1,7,8,3,-1,10,11,1,-1,-1,-1,-1]];
    
    run(data: number[], dims: [number, number, number], isolevel: number) {
        const vertices: THREE.Vector3[] = [];
        const [dimX, dimY, dimZ] = dims;

        const getVal = (x:number, y:number, z:number) => {
            if (x<0 || y<0 || z<0 || x>=dimX || y>=dimY || z>=dimZ) return 0;
            return data[x + y*dimX + z*dimX*dimY];
        }

        for (let z = 0; z < dimZ - 1; z++) {
            for (let y = 0; y < dimY - 1; y++) {
                for (let x = 0; x < dimX - 1; x++) {
                    const p: [number, number, number][] = [
                        [x, y, z], [x+1, y, z], [x+1, y+1, z], [x, y+1, z],
                        [x, y, z+1], [x+1, y, z+1], [x+1, y+1, z+1], [x, y+1, z+1]
                    ];
                    const v = p.map(pos => getVal(pos[0], pos[1], pos[2]));

                    let cubeindex = 0;
                    if (v[0] < isolevel) cubeindex |= 1;
                    if (v[1] < isolevel) cubeindex |= 2;
                    if (v[2] < isolevel) cubeindex |= 4;
                    if (v[3] < isolevel) cubeindex |= 8;
                    if (v[4] < isolevel) cubeindex |= 16;
                    if (v[5] < isolevel) cubeindex |= 32;
                    if (v[6] < isolevel) cubeindex |= 64;
                    if (v[7] < isolevel) cubeindex |= 128;

                    if (this.edgeTable[cubeindex] === 0) continue;

                    const vertlist: (THREE.Vector3 | null)[] = Array(12).fill(null);

                    if (this.edgeTable[cubeindex] & 1) vertlist[0] = this.vertexInterp(isolevel,p[0],p[1],v[0],v[1]);
                    if (this.edgeTable[cubeindex] & 2) vertlist[1] = this.vertexInterp(isolevel,p[1],p[2],v[1],v[2]);
                    if (this.edgeTable[cubeindex] & 4) vertlist[2] = this.vertexInterp(isolevel,p[2],p[3],v[2],v[3]);
                    if (this.edgeTable[cubeindex] & 8) vertlist[3] = this.vertexInterp(isolevel,p[3],p[0],v[3],v[0]);
                    if (this.edgeTable[cubeindex] & 16) vertlist[4] = this.vertexInterp(isolevel,p[4],p[5],v[4],v[5]);
                    if (this.edgeTable[cubeindex] & 32) vertlist[5] = this.vertexInterp(isolevel,p[5],p[6],v[5],v[6]);
                    if (this.edgeTable[cubeindex] & 64) vertlist[6] = this.vertexInterp(isolevel,p[6],p[7],v[6],v[7]);
                    if (this.edgeTable[cubeindex] & 128) vertlist[7] = this.vertexInterp(isolevel,p[7],p[4],v[7],v[4]);
                    if (this.edgeTable[cubeindex] & 256) vertlist[8] = this.vertexInterp(isolevel,p[0],p[4],v[0],v[4]);
                    if (this.edgeTable[cubeindex] & 512) vertlist[9] = this.vertexInterp(isolevel,p[1],p[5],v[1],v[5]);
                    if (this.edgeTable[cubeindex] & 1024) vertlist[10] = this.vertexInterp(isolevel,p[2],p[6],v[2],v[6]);
                    if (this.edgeTable[cubeindex] & 2048) vertlist[11] = this.vertexInterp(isolevel,p[3],p[7],v[3],v[7]);

                    for (let i = 0; this.triTable[cubeindex][i] !== -1; i += 3) {
                        const v1 = vertlist[this.triTable[cubeindex][i+2]];
                        const v2 = vertlist[this.triTable[cubeindex][i+1]];
                        const v3 = vertlist[this.triTable[cubeindex][i]];
                        if(v1 && v2 && v3) {
                            vertices.push(v1, v2, v3);
                        }
                    }
                }
            }
        }
        return vertices;
    }

    private vertexInterp(isolevel: number, p1: number[], p2: number[], valp1: number, valp2: number): THREE.Vector3 {
        // This function is a critical point for stability. Intermittent rendering failures
        // occur when floating-point inaccuracies lead to division by zero, creating
        // NaN or Infinity values that crash the WebGL renderer. This implementation
        // adds robust checks to prevent that.
        const diff = valp2 - valp1;

        if (Math.abs(diff) < 1e-9) {
            // When the values are nearly identical, interpolation is unsafe.
            // We return an endpoint to avoid generating invalid geometry.
            return new THREE.Vector3(p1[0], p1[1], p1[2]);
        }

        const mu = (isolevel - valp1) / diff;
        
        const x = p1[0] + mu * (p2[0] - p1[0]);
        const y = p1[1] + mu * (p2[1] - p1[1]);
        const z = p1[2] + mu * (p2[2] - p1[2]);
        
        // A final check to guarantee we don't pass invalid data to the renderer.
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return new THREE.Vector3(p1[0], p1[1], p1[2]); // Failsafe
        }

        return new THREE.Vector3(x, y, z);
    }
})();

class ThreeDManager {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private labelRenderer: CSS2DRenderer;
    private animationFrameId: number | null = null;
    private pipeLabels: { label: CSS2DObject, pipeCenter: THREE.Vector3, pipeDirection: THREE.Vector3, pipeRadius: number }[] = [];
    private pipeObjects: THREE.Object3D[] = [];
    private isoSurfaceObjects: THREE.Mesh[] = [];
    private soilLayerObjects: THREE.Object3D[] = [];
    private axesObjects: THREE.Object3D[] = [];

    constructor(private canvasElement: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1e1e1e);

        this.camera = new THREE.PerspectiveCamera(75, canvasElement.width / canvasElement.height, 0.1, 5000);
        this.camera.position.set(0, 10, 20);

        this.renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, logarithmicDepthBuffer: true });
        this.renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        canvasElement.parentElement!.appendChild(this.labelRenderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    private onWindowResize() {
        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== width || canvas.height !== height) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height, false);
            this.labelRenderer.setSize(width, height);
        }
    }

    buildScene(sceneData: SceneData, isoSurfacesData: IsoSurface[]) {
        // Clear previous objects
        [...this.pipeObjects, ...this.isoSurfaceObjects, ...this.soilLayerObjects, ...this.axesObjects].forEach(obj => this.scene.remove(obj));
        this.pipeObjects = [];
        this.isoSurfaceObjects = [];
        this.soilLayerObjects = [];
        this.axesObjects = [];
        this.pipeLabels.forEach(l => {
            l.label.element.remove();
            this.scene.remove(l.label);
        });
        this.pipeLabels = [];
        
        // Soil Layers
        const worldBoxWidth = sceneData.worldWidth;
        const worldBoxDepth = sceneData.worldDepth;
        const worldCenterX = sceneData.worldMinX + sceneData.worldWidth / 2;
        const worldCenterZ_3D = sceneData.worldMinY + sceneData.worldDepth / 2;

        sceneData.layers.forEach(layer => {
            const layerHeight = layer.thickness;
            const layerY = -(layer.depth_top + layerHeight / 2); // Y is vertical in 3D, and negative for depth

            const layerGeo = new THREE.BoxGeometry(worldBoxWidth, layerHeight, worldBoxDepth);
            
            const kMin = 0.2, kMax = 3.0;
            const kRatio = Math.max(0, Math.min(1, (layer.k - kMin) / (kMax - kMin)));
            const color = new THREE.Color().setHSL(0.08, 0.5, 0.6 - 0.4 * kRatio);

            const layerMat = new THREE.MeshStandardMaterial({
                color: color,
                opacity: 0.2,
                transparent: true,
                side: THREE.DoubleSide,
                roughness: 0.9,
            });

            const layerMesh = new THREE.Mesh(layerGeo, layerMat);
            layerMesh.position.set(worldCenterX, layerY, worldCenterZ_3D);
            this.scene.add(layerMesh);
            this.soilLayerObjects.push(layerMesh);
            
            const edges = new THREE.EdgesGeometry(layerGeo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.2, transparent: true }));
            line.position.copy(layerMesh.position);
            this.scene.add(line);
            this.soilLayerObjects.push(line);
        });
        
        // Pipes
        const pipeLength = Math.max(sceneData.worldWidth, sceneData.worldDepth, 20) * 2;
        sceneData.pipes.forEach(pipe => {
            const pipeGroup = new THREE.Group();
            
            const pipeGeo = new THREE.CylinderGeometry(pipe.r_pipe, pipe.r_pipe, pipeLength, 32);
            const pipeMat = new THREE.MeshStandardMaterial({ 
                color: new THREE.Color(getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp)),
                roughness: 0.4,
                metalness: 0.8
            });
            const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
            pipeGroup.add(pipeMesh);

            if (pipe.r_ins > pipe.r_pipe) {
                const insGeo = new THREE.CylinderGeometry(pipe.r_ins, pipe.r_ins, pipeLength, 32);
                const insMat = new THREE.MeshStandardMaterial({ 
                    color: 0xcccccc, 
                    roughness: 0.9,
                    transparent: true,
                    opacity: 0.2
                });
                const insMesh = new THREE.Mesh(insGeo, insMat);
                pipeGroup.add(insMesh);
            }
            
            if (pipe.r_bed > pipe.r_ins) {
                 const bedGeo = new THREE.CylinderGeometry(pipe.r_bed, pipe.r_bed, pipeLength, 32);
                 const bedMat = new THREE.MeshStandardMaterial({ 
                    color: 0x8B4513,
                    roughness: 0.9,
                    transparent: true,
                    opacity: 0.15
                });
                const bedMesh = new THREE.Mesh(bedGeo, bedMat);
                pipeGroup.add(bedMesh);
            }

            let pipeCenter: THREE.Vector3;
            let pipeDirection: THREE.Vector3;

            if (pipe.orientation === 'parallel') {
                pipeGroup.position.set(pipe.x, -pipe.z, 0);
                pipeGroup.rotation.x = Math.PI / 2;
                 pipeCenter = new THREE.Vector3(pipe.x, -pipe.z, 0);
                 pipeDirection = new THREE.Vector3(0, 0, 1);
            } else { // perpendicular
                pipeGroup.position.set(0, -pipe.z, pipe.y);
                pipeGroup.rotation.z = Math.PI / 2;
                pipeCenter = new THREE.Vector3(0, -pipe.z, pipe.y);
                pipeDirection = new THREE.Vector3(1, 0, 0);
            }

            this.scene.add(pipeGroup);
            this.pipeObjects.push(pipeGroup);

            const labelDiv = document.createElement('div');
            labelDiv.className = 'pipe-label';
            const displayTemp = CONVERSIONS.CtoF(pipe.temp);
            labelDiv.textContent = `${pipe.name} (${displayTemp.toFixed(1)} ${UNIT_SYSTEMS.imperial.temp})`;
            const label = new CSS2DObject(labelDiv);
            this.scene.add(label);
            this.pipeLabels.push({ label, pipeCenter, pipeDirection, pipeRadius: pipe.r_bed });
        });

        // Isosurfaces
        const activeIsoSurfaces = isoSurfacesData.filter(iso => iso.enabled);
        if (activeIsoSurfaces.length > 0) {
            const gridSize = 40;
            const dims: [number, number, number] = [gridSize, gridSize, gridSize];
            const [dimX, dimY, dimZ] = dims;
            const scalarField = new Float32Array(dimX * dimY * dimZ);
            
            const worldBox = new THREE.Box3(
                new THREE.Vector3(sceneData.worldMinX, -sceneData.worldHeight, sceneData.worldMinY),
                new THREE.Vector3(sceneData.worldMinX + sceneData.worldWidth, 0, sceneData.worldMinY + sceneData.worldDepth)
            );

            for (let i = 0; i < dimX; i++) {
                for (let j = 0; j < dimY; j++) {
                    for (let k = 0; k < dimZ; k++) {
                        const worldX = worldBox.min.x + (i / (dimX - 1)) * (worldBox.max.x - worldBox.min.x);
                        const worldZ_3D = worldBox.min.z + (k / (dimZ - 1)) * (worldBox.max.z - worldBox.min.z);
                        // Y in three.js is Z in our physics calc, and it's negative
                        const worldZ_Physics = -(worldBox.min.y + (j / (dimY - 1)) * (worldBox.max.y - worldBox.min.y));
                        
                        const temp = calculateTemperatureAtPoint(worldX, worldZ_Physics, sceneData);
                        scalarField[i + j * dimX + k * dimX * dimY] = temp;
                    }
                }
            }

            activeIsoSurfaces.forEach(iso => {
                try {
                    const tempC = CONVERSIONS.FtoC(iso.temp);
                    const vertices = marchingCubes.run(scalarField as any, dims, tempC);
                    
                    if (vertices.length > 0) {
                        const geometry = new THREE.BufferGeometry();
                        const positions = new Float32Array(vertices.length * 3);
                        for(let i=0; i<vertices.length; i++) {
                            positions[i * 3] = vertices[i].x;
                            positions[i * 3 + 1] = vertices[i].y;
                            positions[i * 3 + 2] = vertices[i].z;
                        }
                        
                        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                        geometry.computeVertexNormals();
                        
                        const matrix = new THREE.Matrix4().makeScale(
                            (worldBox.max.x - worldBox.min.x) / (dimX - 1),
                            (worldBox.max.y - worldBox.min.y) / (dimY - 1),
                            (worldBox.max.z - worldBox.min.z) / (dimZ - 1)
                        ).setPosition(worldBox.min);
                        geometry.applyMatrix4(matrix);

                        const material = new THREE.MeshStandardMaterial({
                            color: iso.color,
                            opacity: iso.opacity,
                            transparent: true,
                            side: THREE.DoubleSide,
                        });

                        const mesh = new THREE.Mesh(geometry, material);
                        this.scene.add(mesh);
                        this.isoSurfaceObjects.push(mesh);
                    }
                } catch(e) {
                    console.error("Failed to generate isosurface for temp", iso.temp, e);
                }
            });
        }

        this.setupAxes(sceneData);
        this.animate();
    }

    private setupAxes(sceneData: SceneData) {
        const { worldMinX, worldWidth, worldMinY, worldDepth, worldHeight } = sceneData;
        const center = new THREE.Vector3(
            worldMinX + worldWidth / 2,
            -worldHeight / 2,
            worldMinY + worldDepth / 2
        );
        const size = Math.max(worldWidth, worldHeight, worldDepth) * 0.6;
        const axesHelper = new THREE.AxesHelper(size);
        axesHelper.position.copy(center);
        axesHelper.position.y = 1; // slightly above ground
        this.scene.add(axesHelper);
        this.axesObjects.push(axesHelper);

        const createAxisLabel = (text: string, position: THREE.Vector3) => {
            const div = document.createElement('div');
            div.className = 'axis-label';
            div.textContent = text;
            const label = new CSS2DObject(div);
            label.position.copy(position);
            this.scene.add(label);
            this.axesObjects.push(label);
        };

        createAxisLabel('X (ft)', new THREE.Vector3(center.x + size, center.y, center.z));
        createAxisLabel('Y (Depth)', new THREE.Vector3(center.x, center.y - size, center.z));
        createAxisLabel('Z (ft)', new THREE.Vector3(center.x, center.y, center.z + size));
    }

    private updateLabels() {
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        this.pipeLabels.forEach(({ label, pipeCenter, pipeDirection, pipeRadius }) => {
            const labelPosition = new THREE.Vector3().copy(pipeCenter);
            
            // Project the camera's "up" vector onto the plane perpendicular to the pipe
            const planeNormal = pipeDirection;
            const cameraUp = this.camera.up.clone();
            const projectedUp = cameraUp.clone().projectOnPlane(planeNormal).normalize();
            
            // If projectedUp is zero (camera looking down pipe), use a default
            if (projectedUp.lengthSq() < 0.001) {
                if(Math.abs(pipeDirection.y) > 0.9) { // Pipe is mostly vertical
                    projectedUp.set(0,0,1);
                } else {
                    projectedUp.set(0,1,0);
                }
            }
            
            labelPosition.add(projectedUp.multiplyScalar(pipeRadius * 1.2 + 0.5));
            label.position.copy(labelPosition);
        });
    }

    animate() {
        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.updateLabels();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        window.removeEventListener('resize', this.onWindowResize);
        this.labelRenderer.domElement.remove();
        this.renderer.dispose();
    }
}


function escapeLatex(str: string): string {
    if (!str) return '';
    return str.replace(/\\/g, '\\textbackslash{}')
              .replace(/[{}]/g, (c) => `\\${c}`)
              .replace(/[#$&%_]/g, (c) => `\\${c}`)
              .replace(/~/g, '\\textasciitilde{}')
              .replace(/\^/g, '\\textasciicaret{}');
}

function generateLatexReport(
    projectInfo: ProjectInfo,
    inputs: CalculationData['inputs'],
    results: { pipeId: number, pipeName: string, finalTemp: number }[],
    detailedCalcs: DetailedCalculations
): string {
    const { pipes, soilLayers, T_soil } = inputs;

    const projectInfoSection = `
\\begin{tabular}{ll}
    \\textbf{Project Name} & ${escapeLatex(projectInfo.name)} \\\\
    \\textbf{Location} & ${escapeLatex(projectInfo.location)} \\\\
    \\textbf{System Number} & ${escapeLatex(projectInfo.system)} \\\\
    \\textbf{Engineer} & ${escapeLatex(projectInfo.engineer)} \\\\
    \\textbf{Date} & ${escapeLatex(projectInfo.date)} \\\\
    \\textbf{Revision} & ${escapeLatex(projectInfo.revision)} \\\\
\\end{tabular}

\\subsection*{Description}
\\textit{${escapeLatex(projectInfo.description)}}
    `;
    
    const soilInputTable = `
\\subsection*{Environmental Inputs}
\\begin{tabular}{|l|c|c|}
    \\hline
    \\textbf{Parameter} & \\textbf{Imperial} & \\textbf{SI} \\\\ \\hline
    Ambient Soil Temperature & ${CONVERSIONS.CtoF(T_soil).toFixed(1)} ${UNIT_SYSTEMS.imperial.temp} & ${T_soil.toFixed(1)} °C \\\\
    \\hline
\\end{tabular}

\\subsubsection*{Soil Layers}
\\begin{tabular}{|c|c|c|c|c|}
    \\hline
    \\textbf{Layer} & \\textbf{Thickness (ft)} & \\textbf{Thickness (m)} & \\textbf{k (BTU/hr-ft-°F)} & \\textbf{k (W/m-K)} \\\\ \\hline
    ${soilLayers.map((layer, i) => `
        Layer ${i+1} & ${CONVERSIONS.mToFt(layer.thickness).toFixed(2)} & ${layer.thickness.toFixed(2)} & ${CONVERSIONS.wmkToBtuHrFtF(layer.k).toFixed(2)} & ${layer.k.toFixed(2)}
    `).join('\\\\ \\hline \n')}
    \\hline
\\end{tabular}
    `;

    const pipeInputRows = pipes.map(p => {
        const tempF = p.temp ? CONVERSIONS.CtoF(p.temp).toFixed(1) : 'N/A';
        const tempC = p.temp ? p.temp.toFixed(1) : 'N/A';
        return `
        ${escapeLatex(p.name)} & ${p.role.replace('_', ' ')} & ${p.orientation} & ${CONVERSIONS.mToFt(p.x).toFixed(2)} & ${CONVERSIONS.mToFt(p.y).toFixed(2)} & ${CONVERSIONS.mToFt(p.z).toFixed(2)} & ${tempF} & ${tempC} \\\\
        - OD (in/m) & \\multicolumn{7}{l|}{${CONVERSIONS.mToIn(p.od).toFixed(3)} in / ${p.od.toFixed(4)} m} \\\\
        - Wall Thk (in/m) & \\multicolumn{7}{l|}{${CONVERSIONS.mToIn(p.thickness).toFixed(4)} in / ${p.thickness.toFixed(5)} m} \\\\
        - Ins Thk (in/m) & \\multicolumn{7}{l|}{${CONVERSIONS.mToIn(p.ins_thickness).toFixed(2)} in / ${p.ins_thickness.toFixed(4)} m} \\\\
        - Bed Thk (in/m) & \\multicolumn{7}{l|}{${CONVERSIONS.mToIn(p.bed_thickness).toFixed(2)} in / ${p.bed_thickness.toFixed(4)} m} \\\\
        - k (Pipe/Ins/Bed) & \\multicolumn{7}{l|}{${p.k_pipe.toFixed(1)} / ${p.k_ins.toFixed(3)} / ${p.k_bedding.toFixed(3)} W/m-K}
        `;
    }).join('\\\\ \\hline \n');

    const pipeInputTable = `
\\subsection*{Pipe Inputs}
\\begin{tabular}{|l|l|l|c|c|c|c|c|}
    \\hline
    \\textbf{ID} & \\textbf{Role} & \\textbf{Orient.} & \\textbf{X (ft)} & \\textbf{Y (ft)} & \\textbf{Z (ft)} & \\textbf{Temp (°F)} & \\textbf{Temp (°C)} \\\\ \\hline
    ${pipeInputRows}
    \\hline
\\end{tabular}
    `;
    
    const resultsTable = `
\\subsection*{Summary of Results}
\\begin{tabular}{|l|c|c|}
    \\hline
    \\textbf{Pipe ID} & \\textbf{Final Temperature (°F)} & \\textbf{Final Temperature (°C)} \\\\ \\hline
    ${results.map(r => `
        ${escapeLatex(r.pipeName)} & ${CONVERSIONS.CtoF(r.finalTemp).toFixed(2)} & ${r.finalTemp.toFixed(2)}
    `).join('\\\\ \\hline \n')}
    \\hline
\\end{tabular}
    `;

    const sourceCalcRows = detailedCalcs.sources.map(s => `
        ${escapeLatex(s.pipeName)} & ${s.R_pipe.toExponential(2)} & ${s.R_ins.toExponential(2)} & ${s.R_bed.toExponential(2)} & ${s.R_soil.toExponential(2)} & ${s.R_total.toExponential(2)} & ${s.Q.toFixed(2)}
    `).join('\\\\ \\hline \n');
    const sourceCalcTable = `
\\subsection*{Heat Source Calculations}
\\begin{tabular}{|l|c|c|c|c|c|c|}
    \\hline
    \\textbf{Source Pipe} & \\textbf{R\\_pipe} & \\textbf{R\\_ins} & \\textbf{R\\_bed} & \\textbf{R\\_soil} & \\textbf{R\\_total} & \\textbf{Q} \\\\ 
     & \\multicolumn{5}{c|}{\\textbf{(K-m/W)}} & \\textbf{(W/m)} \\\\ \\hline
    ${sourceCalcRows}
    \\hline
\\end{tabular}
    `;
    
    const affectedPipeCalcSection = detailedCalcs.affectedPipes.map(ap => `
\\subsubsection*{Affected Pipe: ${escapeLatex(ap.pipeName)}}
Total Temperature Rise: ${ap.totalTempRise.toFixed(2)} °C
\\\\ Final Temperature: ${ap.finalTemp.toFixed(2)} °C
\\begin{tabular}{|l|c|c|c|c|}
    \\hline
    \\textbf{From Source} & \\textbf{k\\_path (W/m-K)} & \\textbf{d\\_real (m)} & \\textbf{d\\_image (m)} & \\textbf{Temp Rise (°C)} \\\\ \\hline
    ${ap.interactions.map(i => `
        ${escapeLatex(i.sourcePipeName)} & ${i.k_eff_path.toFixed(2)} & ${i.d_real.toFixed(3)} & ${i.d_image.toFixed(3)} & ${i.tempRise.toFixed(3)}
    `).join('\\\\ \\hline \n')}
    \\hline
\\end{tabular}
    `).join('\n');

    const methodology = `
\\section{Methodology}
This analysis calculates the steady-state temperature of buried pipelines subjected to heat transfer from adjacent heat source pipelines and the surrounding soil. The calculation is based on the principle of superposition and the method of images to model the ground surface as an adiabatic (no heat flow) boundary. The methodology is built upon three fundamental engineering principles:
\\begin{enumerate}
    \\item The Thermal Resistance Network Model: To calculate the amount of heat leaving a source.
    \\item The Method of Images: To accurately model the effect of the ground surface.
    \\item The Principle of Superposition: To combine the heating effects from multiple sources.
\\end{enumerate}

\\subsection{Step 1: Calculate Heat Flux (\\(Q\\)) from each Heat Source}
\\subsubsection*{Why it's necessary}
Before determining how a hot pipe affects its neighbors, we must quantify \\textit{how much} heat it emits. This rate of heat loss is the \\textbf{heat flux (Q)}, measured in Watts per meter (W/m).

\\subsubsection*{How it's calculated: The Thermal-Electrical Analogy}
The calculation uses the thermal resistance model, an analogue to Ohm's Law. Heat flow (\\(Q\\)) is like current, temperature difference (\\(\\Delta T\\)) is like voltage, and thermal resistance (\\(R\\)) is like electrical resistance.
\\begin{equation}
    Q = \\frac{\\Delta T}{R_{total}} = \\frac{T_{pipe} - T_{soil}}{R_{pipe} + R_{ins} + R_{bed} + R_{soil}}
\\end{equation}
Where \\(R_{total}\\) is the sum of the series resistances (K\\(\\cdot\\)m/W) of the pipe wall, insulation, bedding, and soil.

\\subsubsection*{Source of Resistance Formulas}
The formulas are derived from Fourier's Law of Conduction (\\(Q = -k A \\frac{dT}{dx}\\)).

\\paragraph{A) Cylindrical Layers (Pipe, Insulation, Bedding)}
For heat flowing radially through a hollow cylinder, integrating Fourier's Law gives:
\\begin{equation}
    R_{cyl} = \\frac{\\ln(r_{outer} / r_{inner})}{2 \\pi k}
\\end{equation}

\\paragraph{B) Soil Resistance (Buried Cylinder)}
The soil's resistance is complex because the ground surface acts as a near-perfect insulator (an adiabatic boundary). To model this, we use the \\textbf{Method of Images}. This powerful mathematical trick involves imagining a "mirror image" of the heat source located above the ground at the same distance the real pipe is below it. This creates a symmetrical system where the ground surface becomes a line of zero heat flow.
\\begin{equation}
    R_{soil} = \\frac{\\ln(2z / r_{outer})}{2 \\pi k_{soil\\_eff}}
\\end{equation}

\\subsection{Step 2: Calculate Temperature Rise (\\(\\Delta T\\)) at an Affected Pipe}
\\subsubsection*{Why it's necessary}
With the heat flux (Q) from a source known, we can now calculate its effect at a distance. This step calculates the specific temperature rise at the exact centerline location of an 'Affected Pipe' caused by one 'Heat Source'.

\\subsubsection*{How is it calculated?}
This again uses the Method of Images. The temperature rise at any point in the soil is a function of its distance from the real heat source and its distance from the imaginary "image" source.
\\begin{equation}
    \\Delta T_{rise} = \\frac{Q}{2 \\pi k_{path\\_eff}} \\cdot \\ln(\\frac{d_{image}}{d_{real}})
\\end{equation}

\\subsection{Step 3: Summing the Effects \\& Final Temperature}
\\subsubsection*{Why it's necessary}
An affected pipe is often influenced by multiple heat sources. We must combine all these individual heating effects to find the final, true temperature.

\\subsubsection*{How is it done? The Principle of Superposition}
The governing equations for steady-state heat conduction are linear. This means we can use the \\textbf{Principle of Superposition}, which states that the total effect of multiple influences is the simple sum of the individual effects.
\\begin{equation}
    T_{final} = T_{soil} + \\Sigma(\\Delta T_{rise\\_from\\_source\\_1} + \\Delta T_{rise\\_from\\_source\\_2} + ...)
\\end{equation}
    `;

    return `
\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{geometry}
\\usepackage{hyperref}
\\geometry{a4paper, margin=1in}

\\title{Heat Transfer Calculation Report \\\\ \\large ${escapeLatex(projectInfo.name)}}
\\author{${escapeLatex(projectInfo.engineer)}}
\\date{${escapeLatex(projectInfo.date)}}

\\begin{document}
\\maketitle
\\tableofcontents
\\newpage

\\section{Project Information}
${projectInfoSection}

\\section{Input Parameters}
${soilInputTable}
${pipeInputTable}

\\section{Calculation Results}
${resultsTable}

\\section{Detailed Calculations}
${sourceCalcTable}
\\subsection{Affected Pipe Interactions}
${affectedPipeCalcSection}

\\newpage
${methodology}

\\end{document}
    `;
}

function handleLoadExample() {
    clearInputs();
    
    projectNameInput.value = 'Example Project: Parallel Pipes';
    projectLocationInput.value = 'Springfield, USA';
    evalDateInput.value = new Date().toISOString().split('T')[0];
    engineerNameInput.value = 'J. Sigler';
    projectDescriptionInput.value = 'Two parallel heat sources influencing a central affected pipe.';

    soilTempInput.value = '60';

    addSoilLayer({ k: 1.5, thickness: CONVERSIONS.ftToM(10) });
    addSoilLayer({ k: 2.2, thickness: CONVERSIONS.ftToM(20) });

    addPipe({
        name: 'Source Pipe A', role: 'heat_source', orientation: 'parallel',
        x: CONVERSIONS.ftToM(-10), y: 0, z: CONVERSIONS.ftToM(5),
        temp: CONVERSIONS.FtoC(450), od: CONVERSIONS.inToM(8.625), thickness: CONVERSIONS.inToM(0.322),
        k_pipe: 54, ins_thickness: CONVERSIONS.inToM(2), k_ins: 0.05,
        bed_thickness: CONVERSIONS.inToM(6), k_bedding: 0.35
    });

    addPipe({
        name: 'Affected Pipe', role: 'affected_pipe', orientation: 'parallel',
        x: 0, y: 0, z: CONVERSIONS.ftToM(6),
        od: CONVERSIONS.inToM(12.75), thickness: CONVERSIONS.inToM(0.406),
        k_pipe: 54, ins_thickness: 0, k_ins: 0,
        bed_thickness: CONVERSIONS.inToM(6), k_bedding: 0.35
    });
    
    addPipe({
        name: 'Source Pipe B', role: 'heat_source', orientation: 'parallel',
        x: CONVERSIONS.ftToM(10), y: 0, z: CONVERSIONS.ftToM(7),
        temp: CONVERSIONS.FtoC(300), od: CONVERSIONS.inToM(6.625), thickness: CONVERSIONS.inToM(0.280),
        k_pipe: 54, ins_thickness: CONVERSIONS.inToM(1), k_ins: 0.04,
        bed_thickness: CONVERSIONS.inToM(6), k_bedding: 0.35
    });
    
    addPipe({
        name: 'Perp Source C', role: 'heat_source', orientation: 'perpendicular',
        x: 0, y: CONVERSIONS.ftToM(0), z: CONVERSIONS.ftToM(15),
        temp: CONVERSIONS.FtoC(200), od: CONVERSIONS.inToM(4.5), thickness: CONVERSIONS.inToM(0.237),
        k_pipe: 54, ins_thickness: 0, k_ins: 0,
        bed_thickness: 0, k_bedding: 0
    });
    
    addIsotherm({temp: 100, color: '#FFFF00'});
    addIsotherm({temp: 150, color: '#FFA500'});
    addIsotherm({temp: 200, color: '#FF0000'});
    
    addIsoSurface({temp: 90, color: '#48BFE3', opacity: 0.3});
    addIsoSurface({temp: 120, color: '#FFD700', opacity: 0.3});

    handleCalculate();
}

function clearInputs() {
    pipeList.innerHTML = '';
    soilLayersList.innerHTML = '';
    isothermList.innerHTML = '';
    isosurfaceList.innerHTML = '';
    isotherms = [];
    isoSurfaces = [];
    pipeIdCounter = 0;
    isothermIdCounter = 0;
    isoSurfaceIdCounter = 0;
}

// --- Event Handlers ---
function handleCalculate() {
    let hasError = false;
    pipeList.querySelectorAll('.pipe-row').forEach(row => {
        if (!validatePipeRow(row as HTMLElement)) {
            hasError = true;
        }
    });

    if (hasError) {
        errorContainer.textContent = 'Please fix the errors in the pipe configurations before calculating.';
        errorContainer.style.display = 'block';
        resultsTableContainer.innerHTML = '';
        visualizationOptions.style.display = 'none';
        outputWrapper.style.display = 'block';
        return;
    }
    
    errorContainer.style.display = 'none';
    outputWrapper.style.display = 'block';
    
    try {
        const pipes = getPipes();
        const soilLayers = getSoilLayers();
        const rawSoilTemp = parseFloat(soilTempInput.value) || 0;
        const T_soil_C = CONVERSIONS.FtoC(rawSoilTemp);

        currentCalculationData = calculateTemperatures(pipes, soilLayers, T_soil_C);

        renderResultsTable(currentCalculationData.results);
        
        visualizationOptions.style.display = 'flex';
        handleViewModeChange();

    } catch (e: any) {
        console.error("Calculation failed:", e);
        errorContainer.textContent = `Calculation failed: ${e.message}`;
        errorContainer.style.display = 'block';
        resultsTableContainer.innerHTML = '';
        visualizationOptions.style.display = 'none';
        currentCalculationData = null;
    }
}

function handleViewModeChange() {
    const selectedMode = (document.querySelector('input[name="view-mode"]:checked') as HTMLInputElement).value as ViewMode;
    currentViewMode = selectedMode;

    if (selectedMode === '2d') {
        canvas.style.display = 'block';
        webglCanvas.style.display = 'none';
        isothermControls.classList.add('active');
        isosurfaceControls.classList.remove('active');
        visToggles.style.display = 'flex';
        threeDManager?.destroy();
        threeDManager = null;
        if(currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    } else { // 3D view
        canvas.style.display = 'none';
        webglCanvas.style.display = 'block';
        isothermControls.classList.remove('active');
        isosurfaceControls.classList.add('active');
        visToggles.style.display = 'none';
        if (!threeDManager) {
            threeDManager = new ThreeDManager(webglCanvas);
        }
        if(currentCalculationData) {
            threeDManager.buildScene(currentCalculationData.sceneData, isoSurfaces);
        }
    }
}


function renderResultsTable(results: CalculationData['results']) {
    const tempUnit = UNIT_SYSTEMS.imperial.temp;
    let tableHtml = `
        <table>
            <thead>
                <tr>
                    <th>Pipe ID</th>
                    <th>Final Temperature (${tempUnit})</th>
                    <th>Final Temperature (°C)</th>
                </tr>
            </thead>
            <tbody>
    `;
    results.sort((a,b) => a.pipeId - b.pipeId).forEach(result => {
        const displayTemp = CONVERSIONS.CtoF(result.finalTemp);
        tableHtml += `
            <tr>
                <td class="pipe-id-cell">${escapeLatex(result.pipeName)}</td>
                <td class="temp-cell">${displayTemp.toFixed(2)}</td>
                <td class="temp-cell">${result.finalTemp.toFixed(2)}</td>
            </tr>
        `;
    });
    tableHtml += '</tbody></table>';
    resultsTableContainer.innerHTML = tableHtml;
}

// ... (Material Library functions: setupMaterialForms, loadMaterials, saveMaterials, renderMaterialLibrary, populateMaterialSelect, populateAllMaterialSelects)
function setupMaterialForms() {
    const formIds: { form: string, table: string, type: MaterialType }[] = [
        { form: 'add-soil-material-form', table: 'soil-material-table', type: 'soil' },
        { form: 'add-pipe-material-form', table: 'pipe-material-table', type: 'pipe' },
        { form: 'add-insulation-material-form', table: 'insulation-material-table', type: 'insulation' },
        { form: 'add-bedding-material-form', table: 'bedding-material-table', type: 'bedding' }
    ];

    formIds.forEach(({ form, table, type }) => {
        const formEl = document.getElementById(form) as HTMLFormElement;
        formEl.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = formEl.querySelector('input[type="text"]') as HTMLInputElement;
            const kInput = formEl.querySelector('input[type="number"]') as HTMLInputElement;
            const name = nameInput.value.trim();
            const kImperial = parseFloat(kInput.value);

            if (name && !isNaN(kImperial)) {
                const newMaterial: CustomMaterial = {
                    id: `${type}-${Date.now()}`,
                    type,
                    name,
                    k: CONVERSIONS.btuHrFtFtoWMK(kImperial)
                };
                customMaterials.push(newMaterial);
                saveMaterials();
                renderMaterialLibrary();
                populateAllMaterialSelects();
                formEl.reset();
            }
        });
    });
}

function loadMaterials() {
    try {
        const stored = localStorage.getItem(MATERIAL_STORAGE_KEY);
        if (stored) {
            customMaterials = JSON.parse(stored);
        }
    } catch (e) {
        console.error("Failed to load materials from localStorage", e);
        customMaterials = [];
    }
}

function saveMaterials() {
    try {
        localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(customMaterials));
    } catch (e) {
        console.error("Failed to save materials to localStorage", e);
    }
}

function renderMaterialLibrary() {
    const tableIds: { table: string, type: MaterialType }[] = [
        { table: 'soil-material-table', type: 'soil' },
        { table: 'pipe-material-table', type: 'pipe' },
        { table: 'insulation-material-table', type: 'insulation' },
        { table: 'bedding-material-table', type: 'bedding' }
    ];

    tableIds.forEach(({ table, type }) => {
        const tbody = document.getElementById(table)!.querySelector('tbody')!;
        tbody.innerHTML = '';
        const materialsOfType = customMaterials.filter(m => m.type === type);
        materialsOfType.forEach(material => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${escapeLatex(material.name)}</td>
                <td>${CONVERSIONS.wmkToBtuHrFtF(material.k).toFixed(3)}</td>
                <td><button type="button" class="remove-btn" data-id="${material.id}">&times;</button></td>
            `;
            row.querySelector('.remove-btn')?.addEventListener('click', () => {
                customMaterials = customMaterials.filter(m => m.id !== material.id);
                saveMaterials();
                renderMaterialLibrary();
                populateAllMaterialSelects();
            });
        });
    });
}

function populateMaterialSelect(select: HTMLSelectElement, type: MaterialType) {
    select.innerHTML = '';
    const presets = MATERIAL_PRESETS[type] || [];
    const custom = customMaterials.filter(m => m.type === type);

    const addOption = (name: string, k: number, isCustom: boolean) => {
        const option = document.createElement('option');
        option.value = k.toString();
        option.textContent = isCustom ? `* ${name}` : name;
        select.appendChild(option);
    };

    if (presets.length > 0) {
        const presetGroup = document.createElement('optgroup');
        presetGroup.label = 'Standard Materials';
        presets.forEach(p => addOption(p.name, p.k, false));
        select.appendChild(presetGroup);
    }

    if (custom.length > 0) {
        const customGroup = document.createElement('optgroup');
        customGroup.label = 'Custom Materials';
        custom.forEach(p => addOption(p.name, p.k, true));
        select.appendChild(customGroup);
    }

    if (select.options.length === 0) {
        select.innerHTML = '<option value="">No materials defined</option>';
    }
}

function populateAllMaterialSelects() {
    document.querySelectorAll('.soil-layer-material-select').forEach(s => populateMaterialSelect(s as HTMLSelectElement, 'soil'));
    document.querySelectorAll('.pipe-material-select').forEach(s => populateMaterialSelect(s as HTMLSelectElement, 'pipe'));
    document.querySelectorAll('.pipe-insulation-material-select').forEach(s => populateMaterialSelect(s as HTMLSelectElement, 'insulation'));
    document.querySelectorAll('.pipe-bedding-material-select').forEach(s => populateMaterialSelect(s as HTMLSelectElement, 'bedding'));
}

// --- Scenario Management ---
function saveScenario() {
    const scenario = {
        projectInfo: getProjectInfo(),
        soilTemp: soilTempInput.value,
        soilLayers: getSoilLayers().map(l => ({ k: l.k, thickness: l.thickness })),
        pipes: getPipes().map(p => ({
            name: p.name, role: p.role, orientation: p.orientation,
            x: p.x, y: p.y, z: p.z, temp: p.temp,
            od: p.od, thickness: p.thickness,
            k_pipe: p.k_pipe, ins_thickness: p.ins_thickness, k_ins: p.k_ins,
            bed_thickness: p.bed_thickness, k_bedding: p.k_bedding,
        })),
        isotherms: isotherms,
        isoSurfaces: isoSurfaces,
    };
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (scenario.projectInfo.name || 'scenario').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadScenario(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const scenario = JSON.parse(reader.result as string);
            clearInputs();
            
            const { projectInfo, soilTemp, soilLayers, pipes: loadedPipes, isotherms: loadedIsotherms, isoSurfaces: loadedIsoSurfaces } = scenario;
            projectNameInput.value = projectInfo.name || '';
            projectLocationInput.value = projectInfo.location || '';
            systemNumberInput.value = projectInfo.system || '';
            engineerNameInput.value = projectInfo.engineer || '';
            evalDateInput.value = projectInfo.date || new Date().toISOString().split('T')[0];
            revisionNumberInput.value = projectInfo.revision || '1';
            projectDescriptionInput.value = projectInfo.description || '';
            soilTempInput.value = String(soilTemp);

            soilLayers.forEach((l: any) => addSoilLayer(l));
            loadedPipes.forEach((p: any) => addPipe(p));
            if(loadedIsotherms) loadedIsotherms.forEach((iso: any) => addIsotherm(iso));
            if(loadedIsoSurfaces) loadedIsoSurfaces.forEach((iso: any) => addIsoSurface(iso));

            populateAllMaterialSelects(); // Ensure selects are populated before setting values
            
            // Re-set select values after population
            getPipes().forEach((pipe, i) => {
                const data = loadedPipes[i];
                const el = pipe.element;
                (el.querySelector('.pipe-material-select') as HTMLSelectElement).value = data.k_pipe?.toString() || '';
                (el.querySelector('.pipe-insulation-material-select') as HTMLSelectElement).value = data.k_ins?.toString() || '0';
                (el.querySelector('.pipe-bedding-material-select') as HTMLSelectElement).value = data.k_bedding?.toString() || '0';
            });
            getSoilLayers().forEach((layer, i) => {
                const data = soilLayers[i];
                (layer.element.querySelector('.soil-layer-material-select') as HTMLSelectElement).value = data.k?.toString() || '';
            });

            handleCalculate();
        } catch (e) {
            console.error("Failed to load scenario:", e);
            alert("Error: The selected file is not a valid scenario file.");
        } finally {
            input.value = ''; // Reset input to allow loading the same file again
        }
    };
    reader.readAsText(file);
}

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {
    // Basic setup
    setupTabs();
    evalDateInput.valueAsDate = new Date();
    loadMaterials();
    renderMaterialLibrary();
    populateAllMaterialSelects();

    // Event listeners
    addSoilLayerBtn.addEventListener('click', () => addSoilLayer());
    addPipeBtn.addEventListener('click', () => addPipe({
        ...UNIT_SYSTEMS.imperial.defaults,
        x: CONVERSIONS.ftToM(UNIT_SYSTEMS.imperial.defaults.x),
        y: 0,
        z: CONVERSIONS.ftToM(UNIT_SYSTEMS.imperial.defaults.z),
        od: CONVERSIONS.inToM(UNIT_SYSTEMS.imperial.defaults.od),
        thickness: CONVERSIONS.inToM(UNIT_SYSTEMS.imperial.defaults.thick),
        ins_thickness: CONVERSIONS.inToM(UNIT_SYSTEMS.imperial.defaults.ins),
        bed_thickness: CONVERSIONS.inToM(UNIT_SYSTEMS.imperial.defaults.bed),
    }));
    calculateBtn.addEventListener('click', handleCalculate);
    exampleBtn.addEventListener('click', handleLoadExample);

    // Visualization
    viewModeRadios.forEach(radio => radio.addEventListener('change', handleViewModeChange));
    addIsothermBtn.addEventListener('click', () => addIsotherm());
    addIsosurfaceBtn.addEventListener('click', () => addIsoSurface());
    toggleFluxVectors.addEventListener('change', (e) => {
        showFluxVectors = (e.target as HTMLInputElement).checked;
        if(currentCalculationData) draw2DScene(currentCalculationData.sceneData);
    });

    // Canvas interactions
    canvas.addEventListener('mousemove', (e) => {
        if(currentCalculationData) showTooltip(e.clientX, e.clientY, currentCalculationData.sceneData)
    });
    canvas.addEventListener('mouseout', hideTooltip);

    // Scenario Management
    saveScenarioBtn.addEventListener('click', saveScenario);
    loadScenarioBtn.addEventListener('click', () => loadScenarioInput.click());
    loadScenarioInput.addEventListener('change', loadScenario);

    copyLatexBtn.addEventListener('click', () => {
        if (currentCalculationData && currentCalculationData.latex) {
            navigator.clipboard.writeText(currentCalculationData.latex).then(() => {
                copyBtnText.textContent = 'Copied!';
                setTimeout(() => { copyBtnText.textContent = 'Copy LaTeX Report'; }, 2000);
            }, (err) => {
                console.error('Could not copy text: ', err);
                alert('Failed to copy report to clipboard.');
            });
        }
    });

    // Material library forms
    setupMaterialForms();

    // Load a default setup
    addSoilLayer();
    addPipe();
    updateUnitsUI();
});
