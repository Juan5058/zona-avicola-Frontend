"""

USO:
    uvicorn server:app --host 127.0.0.1 --port 8001

Antes de usar la medicion de volumen, corre UNA VEZ:
    python calibrar_escala.py
para generar escala_config.json (px por cm), usando la hoja milimetrada
como referencia.
"""

import json
import base64
import math
import numpy as np
import cv2
import torch
import torch.nn as nn
from PIL import Image
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROI_CONFIG_FILE = "roi_config.json"
ESCALA_CONFIG_FILE = "escala_config.json"
SLOTS = 2
IMG_SIZE = 32
MODEL_PATH = "digit_model.pth"
LABELS_PATH = "labels.json"

CATEGORIAS = [
    ("JUMBO", 73, float("inf")),
    ("AAA",   63, 73),
    ("AA",    53, 63),
    ("A",     43, 53),
    ("B",     33, 43),
    ("C",     0,  33),
]

# Mismos cortes que volumenACategoria() en el frontend (clasificacion.service.ts),
# usados como respaldo cuando no hay lectura de peso pero si de volumen.
CATEGORIAS_VOLUMEN = [
    ("JUMBO", 68, float("inf")),
    ("AAA",   58, 68),
    ("AA",    48, 58),
    ("A",     38, 48),
    ("B",     28, 38),
    ("C",     0,  28),
]

# ─── Deteccion del huevo por color (tonos cafe/marron) ──────────────────────
# HSV: descarta blancos/grises de la hoja milimetrada (baja saturacion) y
# lo verdaderamente negro (bascula, sombra dura). Rango ancho para cubrir
# desde cafe claro hasta cafe oscuro (lado en sombra del huevo).
HSV_HUEVO_BAJO = np.array([3,  25,  40])
HSV_HUEVO_ALTO = np.array([32, 255, 255])
AREA_MINIMA_HUEVO = 1500  # px^2, descarta ruido pequeno


def peso_a_categoria(peso):
    if peso is None:
        return None
    for nombre, minv, maxv in CATEGORIAS:
        if minv <= peso < maxv:
            return nombre
    return "C"


def volumen_a_categoria(vol):
    if vol is None or vol <= 0:
        return None
    for nombre, minv, maxv in CATEGORIAS_VOLUMEN:
        if minv <= vol < maxv:
            return nombre
    return "C"


class DigitCNN(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(32 * 8 * 8, 64),
            nn.ReLU(),
            nn.Dropout(0.4),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x


def preprocesar(gray_crop):
    h, w = gray_crop.shape[:2]
    margen = max(1, int(w * 0.10))
    gray_crop = gray_crop.copy()
    gray_crop[0:max(1, int(h * 0.15)), w - margen:w] = int(np.median(gray_crop))

    clahe = cv2.createCLAHE(clipLimit=1.0, tileGridSize=(4, 4))
    eq = clahe.apply(gray_crop)
    blur = cv2.GaussianBlur(eq, (5, 5), 0)
    th = cv2.adaptiveThreshold(
        blur, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21, 10
    )
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
    limpio = np.zeros_like(th)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= 12:
            limpio[labels == i] = 255
    kernel = np.ones((2, 2), np.uint8)
    limpio = cv2.morphologyEx(limpio, cv2.MORPH_CLOSE, kernel)
    return limpio


with open(LABELS_PATH, "r") as f:
    CLASSES = json.load(f)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = DigitCNN(num_classes=len(CLASSES))
model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
model.to(device)
model.eval()
print(f"Modelo cargado. Clases: {CLASSES}")


def predecir_digito(slot_gray):
    proc = preprocesar(slot_gray)
    pil_img = Image.fromarray(proc).resize((IMG_SIZE, IMG_SIZE))
    tensor = torch.from_numpy(np.array(pil_img)).float() / 255.0
    tensor = tensor.unsqueeze(0).unsqueeze(0).to(device)
    with torch.no_grad():
        output = model(tensor)
        pred_idx = output.argmax(dim=1).item()
    return CLASSES[pred_idx]


def leer_roi_actual():
    """Lee roi_config.json desde disco EN CADA LLAMADA, para que recalibrar
    no requiera reiniciar el servidor."""
    with open(ROI_CONFIG_FILE, "r") as f:
        x, y, w, h = json.load(f)
    return x, y, w, h


def leer_escala_actual():
    """Lee escala_config.json (px por cm) desde disco en cada llamada.
    Devuelve None si aun no se ha calibrado (corre calibrar_escala.py)."""
    try:
        with open(ESCALA_CONFIG_FILE, "r") as f:
            data = json.load(f)
        px_por_cm = float(data["px_per_cm"])
        if px_por_cm > 0:
            return px_por_cm
    except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError):
        pass
    return None


def encontrar_punto_de_corte(gray_roi):
    """Busca la columna con MENOS pixeles oscuros en la zona central,
    en vez de asumir que el corte esta siempre a la mitad exacta."""
    _, binaria = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = binaria.shape
    conteo_col = (binaria > 0).sum(axis=0)

    margen = max(3, int(w * 0.20))
    ini, fin = margen, w - margen
    if fin <= ini:
        return w // 2

    ventana = conteo_col[ini:fin]
    idx_min = int(ventana.argmin())
    return ini + idx_min


def leer_peso_de_frame(frame_bgr):
    roi_x, roi_y, roi_w, roi_h = leer_roi_actual()

    h_frame, w_frame = frame_bgr.shape[:2]
    if roi_y + roi_h > h_frame or roi_x + roi_w > w_frame:
        return None, ""

    crop = frame_bgr[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    punto_corte = encontrar_punto_de_corte(gray)
    slots_gray = [gray[:, 0:punto_corte], gray[:, punto_corte:]]

    digitos = []
    for slot_gray in slots_gray:
        label = predecir_digito(slot_gray)
        if label != "blank":
            digitos.append(label)

    raw = "".join(digitos)
    peso = int(raw) if raw.isdigit() and raw != "" else None
    return peso, raw


# ─── Deteccion del huevo + medicion por elipse ──────────────────────────────

def detectar_contorno_huevo(frame_bgr):
    """Detecta el huevo en dos pasos:
    1) Un filtro de color (tonos cafe) da una pista aproximada de donde
       esta el huevo -> de ahi se saca un rectangulo de busqueda.
    2) GrabCut refina esa region usando los bordes reales de la imagen
       (contraste huevo/plato), no solo el color -- esto es lo que permite
       recuperar el lado en sombra del huevo (mas oscuro/menos saturado)
       sin tener que ampliar el rango de color hasta comerse el fondo, y
       hace que el mismo ajuste sirva tanto con mucha luz como con poca.
    Devuelve el contorno final o None si no hay nada que parezca un huevo.
    """
    h_frame, w_frame = frame_bgr.shape[:2]

    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    clahe_v = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    v_eq = clahe_v.apply(v)
    hsv_eq = cv2.merge([h, s, v_eq])
    mascara_color = cv2.inRange(hsv_eq, HSV_HUEVO_BAJO, HSV_HUEVO_ALTO)

    kernel = np.ones((7, 7), np.uint8)
    mascara_color = cv2.morphologyEx(mascara_color, cv2.MORPH_OPEN, kernel)
    mascara_color = cv2.morphologyEx(mascara_color, cv2.MORPH_CLOSE, kernel)

    contornos, _ = cv2.findContours(mascara_color, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return None
    pista = max(contornos, key=cv2.contourArea)
    if cv2.contourArea(pista) < AREA_MINIMA_HUEVO:
        return None

    # rectangulo de busqueda: la pista de color, agrandada bastante para dar
    # espacio de sobra a la parte en sombra que el color por si solo no agarra
    x, y, w, alto_r = cv2.boundingRect(pista)
    margen_x = int(w * 0.7)
    margen_y = int(alto_r * 0.7)
    rx = max(0, x - margen_x)
    ry = max(0, y - margen_y)
    rw = min(w_frame - rx, w + 2 * margen_x)
    rh = min(h_frame - ry, alto_r + 2 * margen_y)
    if rw < 10 or rh < 10:
        return None

    try:
        # nucleo "seguro es huevo": la pista de color erosionada, para
        # anclar fuerte el modelo de color de GrabCut y que desde ahi
        # crezca hacia el lado en sombra (conectado espacialmente)
        nucleo = np.zeros((h_frame, w_frame), np.uint8)
        cv2.drawContours(nucleo, [pista], -1, 255, thickness=cv2.FILLED)
        nucleo = cv2.erode(nucleo, np.ones((15, 15), np.uint8))

        mascara_gc = np.full((h_frame, w_frame), cv2.GC_BGD, np.uint8)
        mascara_gc[ry:ry + rh, rx:rx + rw] = cv2.GC_PR_FGD
        mascara_gc[nucleo == 255] = cv2.GC_FGD

        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)
        cv2.grabCut(frame_bgr, mascara_gc, None,
                    bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_MASK)
        mascara_final = np.where(
            (mascara_gc == cv2.GC_FGD) | (mascara_gc == cv2.GC_PR_FGD), 255, 0
        ).astype("uint8")
    except cv2.error:
        # si grabCut falla por algun motivo, usa la pista de color tal cual
        mascara_final = mascara_color

    mascara_final = cv2.morphologyEx(mascara_final, cv2.MORPH_CLOSE, kernel)
    contornos_final, _ = cv2.findContours(mascara_final, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos_final:
        return None

    mayor = max(contornos_final, key=cv2.contourArea)
    if cv2.contourArea(mayor) < AREA_MINIMA_HUEVO or len(mayor) < 5:
        return None

    perimetro = cv2.arcLength(mayor, True)
    simplificado = cv2.approxPolyDP(mayor, 0.002 * perimetro, True)
    if len(simplificado) >= 5:
        mayor = simplificado
    return mayor


def ajustar_elipse(contorno):
    """cv2.fitEllipseDirect es menos sensible a puntos atipicos que el
    metodo clasico (fitEllipse); si la version de OpenCV no lo trae, usa
    el metodo clasico como respaldo."""
    if hasattr(cv2, "fitEllipseDirect"):
        return cv2.fitEllipseDirect(contorno)
    return cv2.fitEllipse(contorno)


def medir_huevo(frame_bgr, px_por_cm):
    """Ajusta una elipse real al contorno del huevo (no asume ovalo perfecto),
    calcula largo/diametro en cm y el volumen como elipsoide de revolucion.
    Devuelve (volumen_cm3, largo_mm, diametro_mm, elipse) donde elipse trae
    la geometria en pixeles (cx, cy, ancho_px, alto_px, angulo_deg) para que
    el FRONTEND la dibuje sobre su propio canvas — el servidor ya no genera
    una imagen anotada. Devuelve (0, 0, 0, None) si no se detecto huevo."""
    contorno = detectar_contorno_huevo(frame_bgr)
    if contorno is None:
        print("medir_huevo: no se detecto un contorno de huevo valido en este frame")
        return 0.0, 0.0, 0.0, None

    (cx, cy), (ancho_px, alto_px), angulo = ajustar_elipse(contorno)

    eje_mayor_px = max(ancho_px, alto_px)
    eje_menor_px = min(ancho_px, alto_px)

    largo_cm = eje_mayor_px / px_por_cm
    diametro_cm = eje_menor_px / px_por_cm

    volumen = (4.0 / 3.0) * math.pi * (largo_cm / 2.0) * (diametro_cm / 2.0) ** 2

    elipse = {
        "cx": cx, "cy": cy,
        "ancho_px": ancho_px, "alto_px": alto_px,
        "angulo_deg": angulo,
        "largo_cm": round(largo_cm, 1),
        "diametro_cm": round(diametro_cm, 1),
    }

    return volumen, largo_cm * 10, diametro_cm * 10, elipse


app = FastAPI(title="Servidor de vision - ZonaAvicola web")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class FrameRequest(BaseModel):
    frame: str


@app.get("/ping")
def ping():
    return {"status": "ok"}


@app.get("/roi")
def roi():
    """Devuelve el ROI actual (leido de roi_config.json en cada llamada) para
    que el frontend pueda dibujar el contorno de calibracion en rojo."""
    x, y, w, h = leer_roi_actual()
    return {"x": x, "y": y, "w": w, "h": h}


class RoiPositionRequest(BaseModel):
    x: int
    y: int


@app.get("/roi_actual")
def roi_actual():
    x, y, w, h = leer_roi_actual()
    return {"x": x, "y": y, "w": w, "h": h}


@app.post("/mover_roi")
def mover_roi(req: RoiPositionRequest):
    """Cambia SOLO la posicion (x, y) del recuadro. El ancho y alto (w, h)
    quedan intactos, tal como estaban calibrados."""
    _, _, w, h = leer_roi_actual()
    nuevo = [req.x, req.y, w, h]
    with open(ROI_CONFIG_FILE, "w") as f:
        json.dump(nuevo, f)
    return {"status": "ok", "roi": nuevo}

@app.post("/clasificar")
def clasificar(req: FrameRequest):
    try:
        b64 = req.frame.split(",", 1)[1] if "," in req.frame else req.frame
        img_bytes = base64.b64decode(b64)
        npimg = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

        if frame is None:
            return {
                "categoria": "C", "peso_g": None, "volumen_cm3": 0,
                "eje_mayor_mm": 0, "eje_menor_mm": 0,
                "confianza": "estimado", "error": "No se pudo leer la imagen",
                "elipse": None,
            }

        peso, raw = leer_peso_de_frame(frame)

        px_por_cm = leer_escala_actual()
        volumen, largo_mm, diametro_mm, elipse = (0.0, 0.0, 0.0, None)
        error_escala = None
        if px_por_cm is None:
            error_escala = "Falta calibrar escala: corre python calibrar_escala.py"
        else:
            volumen, largo_mm, diametro_mm, elipse = medir_huevo(frame, px_por_cm)

        if peso is not None:
            categoria = peso_a_categoria(peso)
            confianza = "peso"
            error = error_escala  # avisa aunque el peso si se haya leido
        elif volumen > 0:
            categoria = volumen_a_categoria(volumen)
            confianza = "volumen"
            error = None
        else:
            categoria = "C"
            confianza = "estimado"
            error = error_escala or "No se detecto un peso ni un huevo valido"

        return {
            "categoria": categoria,
            "peso_g": peso,
            "volumen_cm3": round(volumen, 1),
            "eje_mayor_mm": round(largo_mm, 1),
            "eje_menor_mm": round(diametro_mm, 1),
            "confianza": confianza,
            "error": error,
            "elipse": elipse,
        }
    except Exception as ex:
        return {
            "categoria": "C", "peso_g": None, "volumen_cm3": 0,
            "eje_mayor_mm": 0, "eje_menor_mm": 0,
            "confianza": "estimado", "error": str(ex),
            "elipse": None,
        }