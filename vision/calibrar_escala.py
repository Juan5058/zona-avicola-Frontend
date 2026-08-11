"""
calibrar_escala.py
--------------------
Calibra cuantos pixeles equivalen a 1 cm, usando la hoja milimetrada que
esta debajo del huevo en la bascula. El servidor (server.py) necesita este
dato para poder convertir el largo/diametro del huevo de pixeles a
centimetros y calcular el volumen real.

USO:
    python calibrar_escala.py

PASOS:
    1. Se abre la camara en vivo, en la MISMA posicion/zoom que usaras
       despues con server.py (no muevas la camara tras calibrar).
    2. Presiona 's' para congelar el frame.
    3. Haz click en DOS puntos de la hoja milimetrada que sepas que estan
       separados una distancia exacta conocida (mientras mas lejos entre
       si, mas precisa la calibracion — por ejemplo el borde de 5 o 10
       cuadros de la cuadricula).
    4. En la terminal te pedira la distancia real en cm entre esos dos
       puntos. Escribela y ENTER.
    5. Se guarda escala_config.json con el valor de pixeles por cm.
       Presiona 'q' para salir, o 's' de nuevo para repetir la calibracion.
"""

import cv2
import json
import math

ESCALA_CONFIG_FILE = "escala_config.json"

puntos = []


def click_evento(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN and len(puntos) < 2:
        puntos.append((x, y))


def calibrar_sobre_frame(frame):
    global puntos
    puntos = []
    clon = frame.copy()
    ventana = "Click en 2 puntos de distancia conocida | q:cancelar"
    cv2.namedWindow(ventana)
    cv2.setMouseCallback(ventana, click_evento)

    while True:
        vista = clon.copy()
        for p in puntos:
            cv2.circle(vista, p, 4, (0, 255, 255), -1)
        if len(puntos) == 2:
            cv2.line(vista, puntos[0], puntos[1], (0, 255, 255), 1)

        cv2.imshow(ventana, vista)
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            cv2.destroyWindow(ventana)
            return None
        if len(puntos) == 2:
            cv2.waitKey(300)
            cv2.destroyWindow(ventana)
            break

    dist_px = math.hypot(puntos[1][0] - puntos[0][0], puntos[1][1] - puntos[0][1])
    print(f"Distancia en pixeles: {dist_px:.1f}")

    while True:
        txt = input("Distancia REAL en cm entre esos dos puntos (ej 5): ").strip()
        try:
            dist_cm = float(txt)
            if dist_cm > 0:
                break
        except ValueError:
            pass
        print("Valor invalido, intenta de nuevo.")

    px_por_cm = dist_px / dist_cm
    print(f"Escala calculada: {px_por_cm:.2f} px/cm")

    with open(ESCALA_CONFIG_FILE, "w") as f:
        json.dump({"px_per_cm": px_por_cm}, f)
    print(f"Guardado en {ESCALA_CONFIG_FILE}")
    return px_por_cm


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("No se pudo abrir la camara. Prueba con otro indice si tienes varias.")
        return

    print("Presiona 's' para congelar el frame y calibrar, 'q' para salir.")
    while True:
        ret, frame = cap.read()
        if not ret:
            print("No se pudo leer frame de la camara.")
            break

        cv2.imshow("Camara - s:calibrar | q:salir", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            break
        elif key == ord('s'):
            calibrar_sobre_frame(frame)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()