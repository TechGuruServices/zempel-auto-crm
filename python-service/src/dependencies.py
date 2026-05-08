from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader
from rockauto_api import RockAutoClient
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rockauto-service")

API_KEY_NAME = "X-Service-Auth-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

async def verify_auth_key(api_key: str = Security(api_key_header)):
    expected_key = os.getenv("SERVICE_AUTH_KEY")
    if not expected_key:
        logger.warning("SERVICE_AUTH_KEY not set in environment!")
        raise HTTPException(status_code=500, detail="Service configuration error")
    
    if api_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid service authentication key")
    return api_key

async def get_client():
    client = RockAutoClient()
    try:
        yield client
    finally:
        await client.close()
