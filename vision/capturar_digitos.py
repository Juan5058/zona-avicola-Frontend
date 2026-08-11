"""
capturar_digitos.py
--------------------
Script para armar el dataset de entrenamiento del modelo de reconocimiento
de digitos de 7 segmentos (bascula del lavadero / ZonaAvicola).

USO:
    1. Corre el script:  python capturar_digitos.py --slots 3
    2. Se abre la camara en vivo. Presiona 's' para seleccionar con el mouse
       el area COMPLETA del display (donde salen todos los digitos juntos).
       Arrastra un rectangulo y presiona ENTER o SPACE para confirmar.
    3. El area seleccionada se divide automaticamente en N franjas
       verticales iguales (una por cada posicion de digito).
    4. Coloca un peso en la bascula. En la ventana de video presiona 'c'
       para capturar el frame actual.
    5. En la TERMINAL te va a pedir: "Numero mostrado en la bascula: "
       Escribe exactamente lo que ves (ej: 45, 7, 100) y ENTER.
       - Si el numero tiene menos digitos que 'slots', se asume que las
         posiciones de la IZQUIERDA estan apagadas/en blanco (se guardan
         como clase 'blank').
    6. Repite el paso 4-5 muchas veces, variando el peso, el angulo de luz,
       etc. Mientras mas variedad, mejor entrena el modelo.
    7. Presiona 'q' en la ventana de video para salir.

Los recortes se guardan en:
    dataset/0/, dataset/1/, ..., dataset/9/, dataset/blank/
listos para entrenar la CNN despues con PyTorch.
"""

import cv2
import numpy as np
import os
import argparse
import time
import json

ROI_CONFIG_FILE = "roi_config.json"

def preprocesar(gray_crop):
    """Preprocesamiento robusto a reflejos/glare del display LCD:
    recorta un pequeno margen de la esquina superior derecha (donde suele
    haber una marca fija del display, ej. punto decimal o icono) antes de
    aplicar CLAHE + threshold + limpieza por area."""
    h, w = gray_crop.shape[:2]
    margen = max(1, int(w * 0.10))  # recorta ~10% del ancho en la esquina sup. derecha
    gray_crop = gray_crop.copy()
    gray_crop[0:max(1, int(h*0.15)), w-margen:w] = int(np.median(gray_crop))  # neutraliza esa zona

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
    area_minima = 12
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= area_minima:
            limpio[labels == i] = 255

    kernel = np.ones((2, 2), np.uint8)
    limpio = cv2.morphologyEx(limpio, cv2.MORPH_CLOSE, kernel)
    return limpio

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, default=0, help="Indice de la camara USB")
    parser.add_argument("--slots", type=int, default=3, help="Cantidad de posiciones de digitos en el display")
    parser.add_argument("--out", type=str, default="dataset", help="Carpeta de salida del dataset")
    args = parser.parse_args()

    for label in list(range(10)) + ["blank"]:
        os.makedirs(os.path.join(args.out, str(label)), exist_ok=True)

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"No se pudo abrir la camara indice {args.camera}. Prueba con --camera 1")
        return

    roi = None  # (x, y, w, h) del display completo

    # si ya existe una calibracion guardada, ofrecerla
    if os.path.exists(ROI_CONFIG_FILE):
        with open(ROI_CONFIG_FILE, "r") as f:
            saved = json.load(f)
        print(f"Se encontro una calibracion guardada: {saved}")
        usar = input("Usar esta calibracion? (S/n): ").strip().lower()
        if usar != "n":
            roi = tuple(saved)
            print(f"Usando ROI guardado: {roi}")

    print("Presiona 's' sobre la ventana de video para seleccionar el area del display.")
    print("Presiona 'c' para capturar una lectura. Presiona 'q' para salir.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("No se pudo leer frame de la camara.")
            break

        display = frame.copy()
        if roi is not None:
            x, y, w, h = roi
            cv2.rectangle(display, (x, y), (x + w, y + h), (0, 255, 0), 2)

        cv2.imshow("Camara - s:seleccionar area | c:capturar | q:salir", display)
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            break

        elif key == ord('s'):
            r = cv2.selectROI("Camara - s:seleccionar area | c:capturar | q:salir", frame, showCrosshair=True)
            if r[2] > 0 and r[3] > 0:
                roi = r
                print(f"Area seleccionada: {roi}")
                with open(ROI_CONFIG_FILE, "w") as f:
                    json.dump(list(roi), f)
                print(f"Calibracion guardada en {ROI_CONFIG_FILE}")

        elif key == ord('c'):
            if roi is None:
                print("Primero selecciona el area con 's'.")
                continue

            x, y, w, h = roi
            crop = frame[y:y+h, x:x+w]
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

            slot_w = w // args.slots
            slot_imgs = []
            for i in range(args.slots):
                sx = i * slot_w
                ex = w if i == args.slots - 1 else (i + 1) * slot_w
                slot_gray = gray[:, sx:ex]
                slot_imgs.append(slot_gray)

            # Mostrar los recortes YA PROCESADOS (como los vera el modelo) en grande
            procesados = [preprocesar(s) for s in slot_imgs]
            preview_raw = np.hstack([cv2.resize(s, (120, 180)) for s in slot_imgs])
            preview_proc = np.hstack([cv2.resize(p, (120, 180)) for p in procesados])
            preview = np.vstack([preview_raw, preview_proc])
            cv2.imshow("Arriba: crudo | Abajo: procesado (asi lo ve el modelo)", preview)
            cv2.waitKey(1)

            print(">> Revisa la ventana de recortes. Si los digitos NO se ven claros y limpios, deja vacio para descartar.")
            numero = input("Numero mostrado en la bascula (ej 45, deja vacio para descartar): ").strip()
            if numero == "":
                print("Descartado.")
                continue
            if not numero.isdigit():
                print("Entrada invalida, se descarta esta captura.")
                continue

            numero_padded = numero.rjust(args.slots, " ")  # espacios = posiciones en blanco
            if len(numero_padded) > args.slots:
                print(f"El numero tiene mas digitos que slots configurados ({args.slots}). Se descarta.")
                continue

            ts = int(time.time() * 1000)
            for i, ch in enumerate(numero_padded):
                label = "blank" if ch == " " else ch
                proc = preprocesar(slot_imgs[i])
                out_path = os.path.join(args.out, label, f"{ts}_{i}.png")
                cv2.imwrite(out_path, proc)

            print(f"Guardado: '{numero}' -> {args.slots} recortes en dataset/")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()