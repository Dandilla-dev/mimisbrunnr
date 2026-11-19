from flask import Blueprint, jsonify, request

from .auth import login_required

bp = Blueprint("shop", __name__)


@bp.before_request
def load_cart():
    request.cart = []


@bp.route("/items", methods=["GET", "POST"])
@login_required
def items():
    data = request.get_json()
    return jsonify(data), 201
