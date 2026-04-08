import { URLExt } from '@jupyterlab/coreutils';

import {
  ServerConnection
} from '@jupyterlab/services';

import type {
  Kernel,
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
	const msg: string = `Error automatically registering Composapy session (session registration could not be executed).`;
	console.error(msg, data.message);
    throw new ServerConnection.ResponseError(response);
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
			await disposeWhenReady(sessionCon);
			continue;
		}
		
		// only want to run the code when it's a new kernel being launched (once)
		if (kernelCache.has(kernel.id)) {
			await disposeWhenReady(sessionCon);
			continue;
		} else {
			kernelCache.set(kernel.id, false);
			console.log("Registering Composapy session.");
		}
		
		// make sure to pass the kernel id for generating the token
		const init = {
			method: 'PATCH',
			headers: {
				'Kernel': kernel.id
			}
		};
			
		// send it
		try {
			await requestAPI<ITokenReply>('token', settings, init);
		} catch {
			// kernel isn't removed from cache to prevent excessive requests (only try to connect once)
			sendRevokeRequest(settings, kernel.id);
			await disposeWhenReady(sessionCon);
			continue;
		}

		// token acquired; add kernel to cache and set listener
		kernelCache.set(kernel.id, true);
		await disposeWhenReady(sessionCon);
	}
}

async function sendRevokeRequest (
	settings: ServerConnection.ISettings,
	kernelId: string
  ): Promise<any> {
	// only send revoke request on kernels that were added to the cache/had a session registered correctly
	if (kernelCache.has(kernelId)) {
		// send token revoke request to composable and remove kernel from cache
		const init = {
			method: 'DELETE',
			headers: {
				'Kernel': kernelId
			}
		};
		try {
			await requestAPI<ITokenReply>('token', settings, init);
		} catch {
			// probably installed outside Composable (delete is not implemented)
		}
	}
}

// properly dispose of session connection that we used to check kernel status
async function disposeWhenReady(session: Session.ISessionConnection) {
  // if it's already 'connected', we can dispose immediately
  if (!session.kernel || session.kernel.connectionStatus === 'connected') {
    session.dispose();
    return;
  }

  // otherwise, wait for the status to change
  return new Promise<void>((resolve) => {
    const onStatusChanged = (sender: Session.ISessionConnection,
			  status: Kernel.ConnectionStatus) => {
      // once it's no longer connecting (either it succeeded or failed permanently)
      if (status === 'connected' || status === 'disconnected') {
        session.connectionStatusChanged.disconnect(onStatusChanged);
        session.dispose();
        resolve();
      }
    };

    session.connectionStatusChanged.connect(onStatusChanged);
  });
}