"""
debug_recorte.py
------------------
Toma una foto ya guardada (ej. foto_prueba.jpg) y muestra EXACTAMENTE
lo que la API recorta y preprocesa para cada posicion de digito.
Sirve para verificar visualmente si el ROI esta bien alineado o si
esta cortando parte de los digitos.

USO:
    python debug_recorte.py foto_prueba.jpg

Guarda las imagenes de diagnostico en debug_output/
"""

import cv2
import numpy as np
import sys
import os
import json

# Se leen automaticamente de roi_config.json (el mismo que usa api.py)
with open("roi_config.json", "r") as f:
    _roi = json.load(f)
ROI_X, ROI_Y, ROI_W, ROI_H = _roi
SLOTS = 2


def preprocesar(gray_crop):
    h, w = gray_crop.shape[:2]
    margen = max(1, int(w * 0.10))
    gray_crop = gray_crop.copy()
    gray_crop[0:max(1, int(h*0.15)), w-margen:w] = int(np.median(gray_crop))

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


def main():
    if len(sys.argv) < 2:
        print("Uso: python debug_recorte.py foto_prueba.jpg")
        return

    path = sys.argv[1]
    frame = cv2.imread(path)
    if frame is None:
        print(f"No se pudo leer la imagen: {path}")
        return

    os.makedirs("debug_output", exist_ok=True)

    h_frame, w_frame = frame.shape[:2]
    print(f"Resolucion de la foto: {w_frame}x{h_frame}")
    print(f"ROI configurado: x={ROI_X} y={ROI_Y} w={ROI_W} h={ROI_H}")

    # Dibujar el ROI sobre la foto completa para ver donde cae
    frame_marcado = frame.copy()
    cv2.rectangle(frame_marcado, (ROI_X, ROI_Y), (ROI_X+ROI_W, ROI_Y+ROI_H), (0, 255, 0), 2)
    cv2.imwrite("debug_output/roi_sobre_foto_completa.png", frame_marcado)

    crop = frame[ROI_Y:ROI_Y+ROI_H, ROI_X:ROI_X+ROI_W]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    cv2.imwrite("debug_output/recorte_completo.png", cv2.resize(crop, (crop.shape[1]*4, crop.shape[0]*4)))

    slot_w = ROI_W // SLOTS
    for i in range(SLOTS):
        sx = i * slot_w
        ex = ROI_W if i == SLOTS - 1 else (i + 1) * slot_w
        slot_gray = gray[:, sx:ex]
        proc = preprocesar(slot_gray)

        grande_crudo = cv2.resize(slot_gray, (slot_gray.shape[1]*6, slot_gray.shape[0]*6))
        grande_proc = cv2.resize(proc, (proc.shape[1]*6, proc.shape[0]*6))

        cv2.imwrite(f"debug_output/slot_{i}_crudo.png", grande_crudo)
        cv2.imwrite(f"debug_output/slot_{i}_procesado.png", grande_proc)

    print("\nListo. Revisa la carpeta debug_output/:")
    print("  - roi_sobre_foto_completa.png -> confirma que el recuadro verde cae bien sobre el display")
    print("  - recorte_completo.png -> el area completa recortada, en grande")
    print("  - slot_0_crudo.png / slot_0_procesado.png -> primera posicion (decenas)")
    print("  - slot_1_crudo.png / slot_1_procesado.png -> segunda posicion (unidades)")


if __name__ == "__main__":
    main()