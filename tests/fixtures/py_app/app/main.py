from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router

DEBUG = False

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])
if not DEBUG:
    app.add_middleware(GZipMiddleware)


@app.middleware("http")
async def timing(request: Request, call_next):
    response = await call_next(request)
    return response


@app.exception_handler(ValueError)
async def value_error(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


for r in (router,):
    app.include_router(r, prefix="/api")
