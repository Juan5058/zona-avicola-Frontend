import cv2

cap = cv2.VideoCapture(0)  # mismo indice que usaste en capturar_digitos.py
if not cap.isOpened():
    print("No se pudo abrir la camara")
else:
    print("Presiona ESPACIO para tomar la foto, 'q' para salir sin guardar")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imshow("Presiona ESPACIO para capturar", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == 32:  # espacio
            cv2.imwrite("foto_prueba.jpg", frame)
            print("Guardada como foto_prueba.jpg")
            break
        elif key == ord('q'):
            break

cap.release()
cv2.destroyAllWindows()