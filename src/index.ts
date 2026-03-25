import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ISessionManager,
  ServerConnection
} from '@jupyterlab/services';

import type {
  Session
} from '@jupyterlab/services';

import { 
  sendTokenRequest
} from './request';

/**
 * Initialization data for the jupyter-composapy-session extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-composapy-session:plugin',
  description: 'A JupyterLab extension for automatically registering a Composapy session when executing Notebooks within Composable.',
  autoStart: true,
  requires: [ISessionManager],
  activate: async (app: JupyterFrontEnd, sessionManager: Session.IManager) => {
	const settings = ServerConnection.makeSettings();
	
	// run once in case this plugin activates after some sessions have started up
	await sendTokenRequest(sessionManager, Array.from(sessionManager.running()), settings);
	
	// when there's a session change, request token generation or revocation
    sessionManager.runningChanged.connect(async (sm: Session.IManager,
      sessions: Session.IModel[]) => {
		await sendTokenRequest(sm, sessions, settings)
	}, this);
  }
};

export default plugin;
