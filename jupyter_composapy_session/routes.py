import json
import queue

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web
import tornado

class TokenRequestHandler(APIHandler):
    
    
    @tornado.web.authenticated
    async def patch(self):
        # Access the server's multi-kernel manager
        km = self.kernel_manager
        
        try:
            # Get kernel id from request
            kernel_id = self.request.headers["Kernel"]
            
            # Get token string from request
            token = self.request.headers["Token"]
            
            # Sanitize token string (only allow - . _ and alphanumerics)
            if not token.replace("-","").replace("_","").replace(".","").isalnum():
                raise ValueError("The provided token is invalid.")
            
            # Get kernel by id and execute code
            kernel = km.get_kernel(kernel_id)
            client = kernel.client()
            client.start_channels()
            session = client.session.session  # use this to only view kernel messages from this connection

            # Construct the code to execute
            code = 'from composapy.session import Session;from composapy.auth import AuthMode;session = Session(auth_mode=AuthMode.TOKEN, credentials="' + token + '");session.register()'
            # Execute the code
            await client.execute(code, silent=True, store_history=False, allow_stdin=False, stop_on_error=True, reply=True)
        
            # Check the final reply message
            reply = await client.get_iopub_msg(timeout=10)

            # Keep getting reply messages until we get to idle execution state on our own session
            try:
                while not (reply['msg_type'] == 'error' and reply['parent_header']['session'] == session) and not ('execution_state' in reply['content'] and reply['content']['execution_state'] == 'idle' and reply['parent_header']['session'] == session):
                    reply = await client.get_iopub_msg(timeout=10)
            except Exception as e:
                self.set_status(500)
                self.finish(json.dumps({
                    "error": "session_error",
                    "message": "Unexpected error executing session registration code.",
                }))
                return
            if reply['msg_type'] == 'error':
                # here we errored out
                self.set_status(500)
                self.finish(json.dumps({
                    "error": "session_error",
                    "message": reply['content']['traceback'],
                }))
            else:
                # here we got a status: idle message
                self.set_status(200)
                self.finish(json.dumps(
                    reply['content']
                ))
        except (KeyError, ValueError):
            self.set_status(401)
            self.finish(json.dumps({
                "error": "token_error",
                "message": "Unusable token.",
            }))
        
        
    @tornado.web.authenticated
    def delete(self):
        self.set_status(501)
        self.finish(json.dumps({
            "error": "proxy_intercept_required",
            "message": "Please install this extension inside a Composable DataLab.",
        }))


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    token_request_pattern = url_path_join(base_url, "composapy", "token")
    handlers = [(token_request_pattern, TokenRequestHandler)]

    web_app.add_handlers(host_pattern, handlers)
