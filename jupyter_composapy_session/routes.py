import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

class TokenRequestHandler(APIHandler):
    
    
    @tornado.web.authenticated
    def get(self):
        raise tornado.web.HTTPError(418)
        
        self.finish(json.dumps({
            "error": "proxy_intercept_required",
            "message": "No Composapy session was registered. Please install this extension inside a Composable DataLab.",
        }))


class TokenRevokeHandler(APIHandler):
    
    
    @tornado.web.authenticated
    def put(self):
        raise tornado.web.HTTPError(418)
        
        self.finish(json.dumps({
            "error": "proxy_intercept_required",
            "message": "No Composapy session was registered. Please install this extension inside a Composable DataLab.",
        }))


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    token_request_pattern = url_path_join(base_url, "composapy", "generate")
    token_revoke_pattern = url_path_join(base_url, "composapy", "revoke")
    handlers = [(token_request_pattern, TokenRequestHandler), (token_revoke_pattern, TokenRevokeHandler)]

    web_app.add_handlers(host_pattern, handlers)
