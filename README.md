# Dockergram

Visualizador de contenedores Docker en tiempo real.

Muestra:
- Estado de contenedores (RUN/OFF)
- Uso de CPU, memoria y red
- Controles Start/Restart/Stop/Kill

## Estructura

- `backend/`: API + WebSocket + integración con Docker
- `frontend/`: interfaz React + escena 3D

## Requisitos

- Docker Desktop (o daemon Docker activo)
- Go 1.26+
- Node.js 20+

## Ejecutar backend 

```powershell
Set-Location backend
$env:DOCKERGRAM_ACTION_TOKEN = "tu-token-seguro"
go run .
```

Si `DOCKERGRAM_ACTION_TOKEN` no está configurado, las acciones Start/Restart/Stop/Kill quedan deshabilitadas.

## Ejecutar frontend 

```powershell
Set-Location frontend
npm install
$env:VITE_ACTION_TOKEN = "tu-token-seguro"
npm run dev
```

Opcionalmente podés configurar `VITE_BACKEND_HTTP_ORIGIN` para apuntar a otro backend.

Frontend: `http://localhost:5173`
Backend: `http://127.0.0.1:8080`
