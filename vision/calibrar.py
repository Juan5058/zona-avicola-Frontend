"""
calibrar.py — Herramienta para calcular MM_POR_PIXEL
Ejecutar UNA VEZ antes de usar el sistema.

Instrucciones:
  1. Poner un objeto de tamaño conocido sobre la hoja milimetrada
     (una moneda de 1000 pesos colombianos mide exactamente 21.75mm de diametro)
  2. Tomar una foto con la misma camara y distancia que usaras en produccion
  3. Ejecutar: python calibrar.py ruta_de_la_foto.jpg
  4. Hacer click en dos puntos separados una distancia CONOCIDA
  5. El script calcula MM_POR_PIXEL y lo muestra para pegar en server.py
"""

import sys
import cv2
import numpy as np

# Distancia real en mm entre los dos puntos que vayas a marcar
DISTANCIA_REAL_MM = 21.75  # diametro moneda 1000 COP — cambiar si usas otro objeto

puntos = []

def click(event, x, y, flags, param):
    global puntos
    if event == cv2.EVENT_LBUTTONDOWN and len(puntos) < 2:
        puntos.append((x, y))
        cv2.circle(param, (x, y), 5, (0, 255, 0), -1)
        if len(puntos) == 2:
            cv2.line(param, puntos[0], puntos[1], (0, 255, 0), 2)
            dist_px = np.linalg.norm(np.array(puntos[0]) - np.array(puntos[1]))
            escala  = DISTANCIA_REAL_MM / dist_px
            texto   = f"MM_POR_PIXEL = {escala:.4f}"
            cv2.putText(param, texto, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            print(f"\n✓ Distancia en pixeles: {dist_px:.1f}px")
            print(f"✓ Distancia real: {DISTANCIA_REAL_MM}mm")
            print(f"\n>>> Pega esto en server.py:  MM_POR_PIXEL = {escala:.4f}\n")
        cv2.imshow("Calibracion", param)

if __name__ == "__main__":
    ruta = sys.argv[1] if len(sys.argv) > 1 else None
    if not ruta:
        print("Uso: python calibrar.py ruta_foto.jpg")
        sys.exit(1)

    img = cv2.imread(ruta)
    if img is None:
        print(f"No se pudo abrir: {ruta}")
        sys.exit(1)

    # Redimensionar si es muy grande para que quepa en pantalla
    h, w = img.shape[:2]
    if w > 1200:
        factor = 1200 / w
        img = cv2.resize(img, (1200, int(h * factor)))

    cv2.namedWindow("Calibracion")
    cv2.setMouseCallback("Calibracion", click, img.copy())
    print(f"Haz click en dos puntos separados {DISTANCIA_REAL_MM}mm en la imagen.")
    print("Presiona Q para salir.")
    cv2.imshow("Calibracion", img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()