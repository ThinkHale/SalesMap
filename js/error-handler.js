// js/error-handler.js — AppErrorHandler (global error pipeline)

const AppErrorHandler = {
  handle(error, context = '') {
    console.error(`[${context}]`, error);
    const msg = (error && (error.userMessage || error.message)) || 'An unexpected error occurred';
    const severity = (error && error.severity) || 'error';

    if (typeof toastManager !== 'undefined' && toastManager) {
      try {
        if (severity === 'warning') toastManager.warning(msg);
        else if (severity === 'info') toastManager.info(msg);
        else toastManager.error(msg);
      } catch (e) { /* toastManager itself failed */ }
    }

    if (typeof activityLog !== 'undefined' && activityLog) {
      try {
        activityLog.logActivity('error', `Error in ${context}: ${msg}`);
      } catch (e) { /* activityLog failed */ }
    }
  },

  create(message, userMessage, severity = 'error') {
    const err = new Error(message);
    err.userMessage = userMessage || message;
    err.severity = severity;
    return err;
  },

  // Wrap a promise and route rejections through handle()
  async wrap(promise, context) {
    try {
      return await promise;
    } catch (err) {
      AppErrorHandler.handle(err, context);
      return null;
    }
  }
};
