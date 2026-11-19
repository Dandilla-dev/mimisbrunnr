from fastapi import APIRouter, Depends

from ..db import Database, get_db
from ..schemas import OrderIn
from ..services.orders import OrderService

router = APIRouter()


@router.post("/orders")
def create_order(payload: OrderIn, database: Database = Depends(get_db)):
    service = OrderService(database)
    order_id, amount = service.create(payload.customer, payload.lines, payload.code)
    return {"id": order_id, "amount": amount}


@router.get("/orders/{customer}")
def list_orders(customer: str, database: Database = Depends(get_db)):
    return OrderService(database).find(customer)
