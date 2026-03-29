# Dockergram

Visualizador de contenedores Docker en tiempo real.

Muestra:
- Estado de contenedores (RUN/OFF)
- Uso de CPU, memoria y red
- Controles Start/Restart/Stop/Kill

## Estructura

- `backend/`: API + WebSocket + integración con Docker
- `frontend/`: interfaz React + escena 3D
- `roadmap.md`: avance y fases

## Requisitos

- Docker Desktop (o daemon Docker activo)
- Go 1.26+
- Node.js 20+

## Ejecutar backend 

```powershell
Set-Location backend
go run .
```

## Ejecutar frontend 

```powershell
Set-Location frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://127.0.0.1:8080`
