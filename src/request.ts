import { URLExt } from '@jupyterlab/coreutils';

import {
  ServerConnection
} from '@jupyterlab/services';

import type {
  Kernel,
  KernelMessage,
  Session
} from '@jupyterlab/services';

export interface ITokenReply {
  token: string;
}

// cache of kernels that have been started (which have already had the session code injected)
// maps to whether or not it has successfully made a token
const kernelCache = new Map<
     string,
     boolean
    >();

/**
 * Call the server extension
 *
 * @param endPoint API REST end point for Composable composapy token request
 * @param serverSettings The server settings to use for the request
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
async function requestAPI<T>(
  endPoint: string,
  serverSettings: ServerConnection.ISettings,
  init: RequestInit = {}
): Promise<T> {
  // Make request to Jupyter API
  const requestUrl = URLExt.join(
    serverSettings.baseUrl,
    'composapy',
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(
      requestUrl,
      init,
      serverSettings
    );
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
	const msg: string = `Error automatically registering Composapy session:`;
	console.error(msg);
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

export async function sendTokenRequest (
	sm: Session.IManager,
	sessions: Session.IModel[],
	settings: ServerConnection.ISettings
  ): Promise<any> {
	
	if (!sessions.length) {
	  return;
	}
	
	// get token for each new session, which will be at the back of the list
	for (let i: number = sessions.length - 1; i >= 0; i--) {
		const session = sessions[i];
		if (!session) {
			continue;
		}
		
		const sessionCon = sm.connectTo({
			model: session
		});
		
		const kernel = sessionCon.kernel;
		
		if (!kernel) {
			continue;
		}
		
		// only want to run the code when it's a new kernel being launched (once)
		if (kernelCache.has(kernel.id)) {
			continue;
		} else {
			kernelCache.set(kernel.id, false);
			console.log("Registering Composapy session.");
		}
		
		// make sure to pass the kernel id for generating the token
		const init = {
			method: 'GET',
			headers: {
				'Token': kernel.id
			}
		};
			
		// first, wait to get datalab token from server
		let data;
		try {
			data = await requestAPI<ITokenReply>('generate', settings, init);
		} catch {
			// remove kernel from cache since no session was registered
			kernelCache.delete(kernel.id);
			continue;
		}
		
		// base64 encoding for code injection
		const bytes = new TextEncoder().encode(data.token);
		let binary = '';
		for (const b of bytes) binary += String.fromCharCode(b);
		const tokenB64 = btoa(binary);
		
		const runCode = [
		  'import base64',
		  'from composapy.session import Session',
		  'from composapy.auth import AuthMode',
		  `token = base64.b64decode("${tokenB64}").decode("utf-8")`,
		  'session = Session(auth_mode=AuthMode.TOKEN, credentials=token)',
		  'session.register()'
		].join('\n');
		
		let message: KernelMessage.IShellMessage;
		
		try {
			message = await kernel.requestExecute({
			  allow_stdin: false,
			  code: runCode,
			  silent: true,
			  stop_on_error: true,
			  store_history: false
			}).done;
		} catch {
			sendRevokeRequest('disconnected', settings, kernel.id);
			console.error('Error automatically registering Composapy session. No session was registered.')
			continue;
		}
		const content: any = message.content;

		if (content.status !== 'ok') {
			// remove kernel from cache since no session was registered
			sendRevokeRequest('disconnected', settings, kernel.id);
			const msg: string = `Error automatically registering Composapy session:`;
			console.error(msg, content);
		} else {
			// token acquired; add kernel to cache and set listener
			kernelCache.set(kernel.id, true);
			sessionCon.connectionStatusChanged.connect(async (s: Session.ISessionConnection,
			  k: Kernel.ConnectionStatus) => {
				sendRevokeRequest(k, settings, kernel.id);
			});
		}
	}
}

async function sendRevokeRequest (
	status: Kernel.ConnectionStatus,
	settings: ServerConnection.ISettings,
	kernelId: string
  ): Promise<any> {
	// only send revoke request on kernels that were added to the cache/had a session registered correctly
	if (kernelCache.has(kernelId) && status === 'disconnected') {
		// send token revoke request to composable and remove kernel from cache
		const init = {
			method: 'PUT',
			headers: {
				'Token': kernelId
			}
		};
		await requestAPI<ITokenReply>('revoke', settings, init);
		kernelCache.delete(kernelId);
	}
}
