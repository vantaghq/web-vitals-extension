/*
 Copyright 2025 vantag.es. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

export class ServerInfo {
  constructor(url) {
    this.url = url;
    this.hostname = this.extractHostname(url);
  }

  extractHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return null;
    }
  }

  async fetchWithTimeout(url, options = {}, timeout = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async getServerInfo() {
    try {
      const response = await this.fetchWithTimeout(
        `https://ipwhois.app/json/${this.hostname}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || 'API error');
      }
      
      return {
        ip: data.ip || 'N/A',
        hostname: this.hostname,
        region: data.region || 'N/A',
        country: data.country || 'N/A',
        countryCode: data.country_code || 'N/A',
        location: data.region && data.country
          ? `${data.region}, ${data.country}`
          : 'N/A',
        timezone: data.timezone || 'N/A',
        latitude: data.latitude || 'N/A',
        longitude: data.longitude || 'N/A',
        coordinates: data.latitude && data.longitude
          ? `${data.latitude}, ${data.longitude}`
          : 'N/A',
        isp: data.isp || 'N/A',
        org: data.org || 'N/A',
        asn: data.asn || 'N/A'
      };
      
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      if (e.message.includes('Failed to fetch')) {
        throw new Error('Network error');
      }
      
      throw e;
    }
  }

  static async load(url) {
    const serverInfo = new ServerInfo(url);
    return await serverInfo.getServerInfo();
  }
}
