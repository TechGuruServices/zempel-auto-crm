from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from src.dependencies import verify_auth_key, get_client
from rockauto_api import RockAutoClient

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="RockAuto Proxy Service")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://zempel-auto-crm.pages.dev"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(SlowAPIMiddleware)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/rockauto/makes")
@limiter.limit("5/second")
async def get_makes(
    request: Request,
    auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_client)
):
    try:
        return await client.get_makes()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rockauto/years/{make}")
@limiter.limit("5/second")
async def get_years(
    make: str,
    request: Request,
    auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_client)
):
    try:
        return await client.get_years_for_make(make)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rockauto/models/{make}/{year}")
@limiter.limit("5/second")
async def get_models(
    make: str,
    year: int,
    request: Request,
    auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_client)
):
    try:
        return await client.get_models_for_make_year(make, year)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rockauto/engines/{make}/{year}/{model}")
@limiter.limit("5/second")
async def get_engines(
    make: str,
    year: int,
    model: str,
    request: Request,
    auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_client)
):
    try:
        return await client.get_engines_for_vehicle(make, year, model)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rockauto/parts/{carcode}")
@limiter.limit("5/second")
async def get_parts(
    carcode: str,
    request: Request,
    auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_client)
):
    try:
        return await client.search_parts(carcode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
