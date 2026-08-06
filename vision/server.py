"""
servidor.py — FastAPI para clasificacion de huevos por vision
"""

import base64
import io
import subprocess
import tempfile
import os
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Configuracion ────────────────────────────────────────────────────────────

MM_POR_PIXEL = 0.2132

CATEGORIAS_PESO = [
    ("JUMBO", 73, float("inf")),
    ("AAA",   63, 73),
    ("AA",    53, 63),
    ("A",     43, 53),
    ("B",     33, 43),
    ("C",      0, 33),
]

CATEGORIAS_VOL = [
    ("JUMBO", 68, float("inf")),
    ("AAA",   58, 68),
    ("AA",    48, 58),
    ("A",     38, 48),
    ("B",     28, 38),
    ("C",      0, 28),
]

LCD_ROI   = (0.55, 0.60, 1.0, 1.0)
HUEVO_ROI = (0.0,  0.0,  0.75, 0.80)

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Clasificador de Huevos", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Modelos ──────────────────────────────────────────────────────────────────

class FrameRequest(BaseModel):
    frame: str

class ResultadoClasificacion(BaseModel):
    categoria:    str
    peso_g:       Optional[float]
    volumen_cm3:  float
    eje_mayor_mm: float
    eje_menor_mm: float
    confianza:    str
    error:        Optional[str]
    frame_anotado: Optional[str] = None  # imagen con elipse dibujada en base64

# ─── Helpers ──────────────────────────────────────────────────────────────────

def b64_a_bgr(b64: str) -> np.ndarray:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    datos = base64.b64decode(b64)
    arr   = np.frombuffer(datos, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

def bgr_a_b64(img: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()

def recortar_roi(img: np.ndarray, roi: tuple) -> np.ndarray:
    h, w = img.shape[:2]
    x1, y1, x2, y2 = roi
    return img[int(y1*h):int(y2*h), int(x1*w):int(x2*w)]

# ─── Lectura de peso LCD ──────────────────────────────────────────────────────

def _preprocesar_lcd(roi_bgr: np.ndarray) -> np.ndarray:
    gris  = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    gris  = clahe.apply(gris)
    _, binaria = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if np.mean(binaria) > 127:
        binaria = cv2.bitwise_not(binaria)
    return binaria

def leer_peso_lcd(img_bgr: np.ndarray) -> Optional[float]:
    roi     = recortar_roi(img_bgr, LCD_ROI)
    binaria = _preprocesar_lcd(roi)
    peso    = _ssocr(binaria)
    if peso is not None:
        return peso
    try:
        import pytesseract
        from PIL import Image as PILImage
        pil_img = PILImage.fromarray(binaria)
        cfg   = r"--psm 7 -c tessedit_char_whitelist=0123456789."
        texto = pytesseract.image_to_string(pil_img, config=cfg).strip()
        val   = float(texto.replace(",", "."))
        if val > 200:  return val
        if val < 10:   return val * 1000
        return val
    except Exception:
        pass
    return None

def _ssocr(binaria: np.ndarray) -> Optional[float]:
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        cv2.imwrite(tmp_path, binaria)
        resultado = subprocess.run(["ssocr", "-T", tmp_path],
                                   capture_output=True, text=True, timeout=3)
        os.unlink(tmp_path)
        if resultado.returncode == 0:
            val = float(resultado.stdout.strip().replace(",", "."))
            if 1 <= val <= 10000:
                return val
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    return None

# ─── Medicion del huevo ───────────────────────────────────────────────────────

def medir_huevo(img_bgr: np.ndarray) -> dict:
    """
    Detecta el huevo, mide sus ejes y dibuja la elipse sobre la imagen completa.
    Retorna dict con medidas + imagen anotada.
    """
    h_full, w_full = img_bgr.shape[:2]
    roi_x1 = int(0.0  * w_full)
    roi_y1 = int(0.0  * h_full)
    roi_x2 = int(0.75 * w_full)
    roi_y2 = int(0.80 * h_full)
    roi = img_bgr[roi_y1:roi_y2, roi_x1:roi_x2]
    h, w = roi.shape[:2]

    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

    # Huevos cafe/marron
    mascara_cafe = cv2.inRange(hsv, np.array([5, 30, 80]), np.array([35, 255, 255]))

    # Huevos blancos/crema — rango mas estrecho para evitar confundir con el plato
    mascara_blanco = cv2.inRange(hsv, np.array([0, 0, 160]), np.array([30, 60, 240]))

    mascara = cv2.bitwise_or(mascara_cafe, mascara_blanco)

    # Morfologia para limpiar
    kernel  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, kernel, iterations=3)
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN,  kernel, iterations=2)

    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    FALLO = {"ok": False, "eje_mayor_mm": 0, "eje_menor_mm": 0,
             "volumen_cm3": 50.0, "frame_anotado": None}

    if not contornos:
        return FALLO

    # Filtrar contornos por area Y por circularidad (el huevo es mas circular que el plato)
    area_min = (h * w) * 0.01
    area_max = (h * w) * 0.60  # evitar que tome todo el plato

    def circularidad(c):
        area = cv2.contourArea(c)
        perim = cv2.arcLength(c, True)
        if perim == 0: return 0
        return 4 * np.pi * area / (perim ** 2)

    contornos_validos = [
        c for c in contornos
        if area_min < cv2.contourArea(c) < area_max and circularidad(c) > 0.5
    ]

    if not contornos_validos:
        return FALLO

    # El huevo: contorno mas circular entre los validos
    huevo = max(contornos_validos, key=circularidad)

    if len(huevo) < 5:
        return FALLO

    (cx, cy), (eje_a_px, eje_b_px), angulo = cv2.fitEllipse(huevo)

    radio_mayor_px = max(eje_a_px, eje_b_px) / 2
    radio_menor_px = min(eje_a_px, eje_b_px) / 2

    # Validar que los ejes sean razonables en pixeles
    # Un huevo real mide 45-75mm, con MM_POR_PIXEL=0.2132 eso es ~210-350 px de diametro
    if radio_mayor_px < 50 or radio_mayor_px > 600:
        return FALLO

    radio_mayor_mm = radio_mayor_px * MM_POR_PIXEL
    radio_menor_mm = radio_menor_px * MM_POR_PIXEL
    eje_mayor_mm   = radio_mayor_mm * 2
    eje_menor_mm   = radio_menor_mm * 2

    a_cm = radio_mayor_mm / 10
    b_cm = radio_menor_mm / 10
    volumen_cm3 = float(np.clip((4/3) * np.pi * a_cm * (b_cm**2), 20, 100))

    # ── Dibujar elipse sobre la imagen completa ───────────────────────────────
    anotada = img_bgr.copy()

    # Offset de la ROI para dibujar en coordenadas del frame completo
    cx_full = cx + roi_x1
    cy_full = cy + roi_y1

    # Elipse verde sobre el huevo
    cv2.ellipse(
        anotada,
        (int(cx_full), int(cy_full)),
        (int(max(eje_a_px, eje_b_px)/2), int(min(eje_a_px, eje_b_px)/2)),
        angulo, 0, 360,
        (0, 230, 0), 3
    )

    # Ejes cruzados
    cv2.line(anotada,
             (int(cx_full - radio_mayor_px), int(cy_full)),
             (int(cx_full + radio_mayor_px), int(cy_full)),
             (0, 200, 255), 2)
    cv2.line(anotada,
             (int(cx_full), int(cy_full - radio_menor_px)),
             (int(cx_full), int(cy_full + radio_menor_px)),
             (0, 200, 255), 2)

    # Texto con medidas
    texto = f"{eje_mayor_mm:.1f}x{eje_menor_mm:.1f}mm"
    cv2.putText(anotada, texto,
                (int(cx_full) - 60, int(cy_full) - int(radio_menor_px) - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 230, 0), 2)

    return {
        "ok":           True,
        "eje_mayor_mm": round(eje_mayor_mm, 1),
        "eje_menor_mm": round(eje_menor_mm, 1),
        "volumen_cm3":  round(volumen_cm3,  1),
        "frame_anotado": bgr_a_b64(anotada),
    }

# ─── Clasificacion ────────────────────────────────────────────────────────────

def clasificar_por_peso(gramos: float) -> str:
    for cat, min_g, max_g in CATEGORIAS_PESO:
        if min_g < gramos <= max_g:
            return cat
    return "C"

def clasificar_por_volumen(vol_cm3: float) -> str:
    for cat, min_v, max_v in CATEGORIAS_VOL:
        if min_v < vol_cm3 <= max_v:
            return cat
    return "C"

# ─── Endpoint principal ───────────────────────────────────────────────────────

@app.post("/clasificar", response_model=ResultadoClasificacion)
async def clasificar(req: FrameRequest):
    img = b64_a_bgr(req.frame)
    if img is None:
        return ResultadoClasificacion(
            categoria="C", peso_g=None, volumen_cm3=50,
            eje_mayor_mm=0, eje_menor_mm=0,
            confianza="volumen", error="No se pudo decodificar la imagen"
        )

    error_msg = None

    medicion = medir_huevo(img)
    if not medicion["ok"]:
        error_msg = "No se detecto el huevo — verifique iluminacion y posicion"

    volumen_cm3    = medicion["volumen_cm3"]
    eje_mayor_mm   = medicion["eje_mayor_mm"]
    eje_menor_mm   = medicion["eje_menor_mm"]
    frame_anotado  = medicion.get("frame_anotado")

    peso_g = leer_peso_lcd(img)

    if peso_g is not None and 10 <= peso_g <= 200:
        categoria = clasificar_por_peso(peso_g)
        confianza = "peso"
    else:
        categoria = clasificar_por_volumen(volumen_cm3)
        confianza = "volumen"
        if peso_g is not None:
            error_msg = f"Peso fuera de rango ({peso_g}g) — se uso volumen"
            peso_g    = None

    return ResultadoClasificacion(
        categoria     = categoria,
        peso_g        = round(peso_g, 1) if peso_g else None,
        volumen_cm3   = volumen_cm3,
        eje_mayor_mm  = eje_mayor_mm,
        eje_menor_mm  = eje_menor_mm,
        confianza     = confianza,
        error         = error_msg,
        frame_anotado = frame_anotado,
    )

@app.get("/ping")
def ping():
    return {"ok": True, "version": "2.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)