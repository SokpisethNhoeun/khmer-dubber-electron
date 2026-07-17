class WebSocketService {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.url = 'ws://127.0.0.1:9847/ws';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connected = false;
    this.onStatusChange = null;
  }

  connect(onStatusChange = null) {
    if (onStatusChange) this.onStatusChange = onStatusChange;
    
    console.log('Connecting to python backend WebSocket...');
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('WebSocket connected.');
      this.connected = true;
      this.reconnectAttempts = 0;
      if (this.onStatusChange) this.onStatusChange('connected');
      
      // Keep alive ping
      this.pingInterval = setInterval(() => {
        this.send('ping');
      }, 10000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { event: eventName, data } = msg;
        
        if (eventName === 'pong') return;
        
        if (this.handlers[eventName]) {
          this.handlers[eventName].forEach(cb => cb(data));
        }
        
        // Catch-all handlers
        if (this.handlers['*']) {
          this.handlers['*'].forEach(cb => cb(eventName, data));
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed.');
      this.connected = false;
      if (this.onStatusChange) this.onStatusChange('disconnected');
      clearInterval(this.pingInterval);

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Reconnecting attempt ${this.reconnectAttempts}...`);
        setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      this.ws.close();
    };
  }

  send(cmd, payload = {}) {
    if (!this.connected || !this.ws) {
      console.warn('Cannot send: WebSocket is not connected.');
      return false;
    }
    this.ws.send(JSON.stringify({ cmd, ...payload }));
    return true;
  }

  on(event, callback) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.handlers[event]) return;
    this.handlers[event] = this.handlers[event].filter(cb => cb !== callback);
  }
}

export const wsService = new WebSocketService();
