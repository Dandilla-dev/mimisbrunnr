from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])


@app.middleware("http")
async def timing(request: Request, call_next):
    response = await call_next(request)
    return response


@app.exception_handler(ValueError)
async def value_error(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


app.include_router(router, prefix="/api")
