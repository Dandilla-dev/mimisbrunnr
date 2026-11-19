from functools import wraps

from flask import request, abort


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not request.headers.get("Authorization"):
            abort(401)
        return view(*args, **kwargs)
    return wrapper
