from flask import Flask

from .views import bp


def create_app():
    app = Flask(__name__)
    app.register_blueprint(bp, url_prefix="/shop")

    @app.errorhandler(404)
    def not_found(e):
        return {"error": "not found"}, 404

    return app
