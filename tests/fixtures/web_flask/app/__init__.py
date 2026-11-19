from flask import Flask

from .views import bp


def register_blueprints(app):
    app.register_blueprint(bp, url_prefix="/shop")


def create_app():
    app = Flask(__name__)
    register_blueprints(app)

    @app.errorhandler(404)
    def not_found(e):
        return {"error": "not found"}, 404

    return app
