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

export class DNSInfo {
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

  async queryDNS(recordType) {
    try {
      const response = await this.fetchWithTimeout(
        `https://dns.google/resolve?name=${this.hostname}&type=${recordType}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/dns-json'
          }
        }
      );
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      return data.Answer || null;
    } catch (e) {
      return null;
    }
  }

  formatRecords(records, format = 'simple') {
    if (!records || records.length === 0) {
      return 'N/A';
    }

    if (format === 'simple') {
      return records.map(r => r.data).join(', ');
    }

    if (format === 'mx') {
      return records
        .sort((a, b) => {
          const priorityA = parseInt(a.data.split(' ')[0]) || 0;
          const priorityB = parseInt(b.data.split(' ')[0]) || 0;
          return priorityA - priorityB;
        })
        .map(r => r.data)
        .join('\n');
    }

    if (format === 'txt') {
      return records.map(r => r.data.replace(/"/g, '')).join('\n');
    }

    return records.map(r => r.data).join('\n');
  }

  async getDNSInfo() {
    try {
      // Query all DNS record types in parallel
      const [aRecords, aaaaRecords, cnameRecords, mxRecords, nsRecords, txtRecords, soaRecords] = await Promise.all([
        this.queryDNS('A'),
        this.queryDNS('AAAA'),
        this.queryDNS('CNAME'),
        this.queryDNS('MX'),
        this.queryDNS('NS'),
        this.queryDNS('TXT'),
        this.queryDNS('SOA')
      ]);

      // Detect CNAMEs from A/AAAA responses when direct CNAME query returns empty.
      // DNS servers often include the CNAME chain in the answer section of A queries.
      const detectedCNAMEs = this.extractCNAMEsFromAnswers(cnameRecords, aRecords, aaaaRecords);

      // Discover common subdomains
      const subdomains = await this.discoverSubdomains();

      return {
        domain: this.hostname,
        aRecord: this.formatRecords(aRecords),
        aaaaRecord: this.formatRecords(aaaaRecords),
        cname: detectedCNAMEs,
        mx: this.formatRecords(mxRecords, 'mx'),
        ns: this.formatRecords(nsRecords, 'list'),
        txt: this.formatRecords(txtRecords, 'txt'),
        soa: this.formatRecords(soaRecords),
        subdomains: subdomains
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

  extractCNAMEsFromAnswers(cnameRecords, aRecords, aaaaRecords) {
    const cnames = new Set();

    // Direct CNAME answers
    if (cnameRecords && cnameRecords.length > 0) {
      cnameRecords.forEach(r => {
        if (r.type === 5) cnames.add(r.data);
      });
    }

    // CNAMEs embedded in A/AAAA responses
    [aRecords, aaaaRecords].forEach(records => {
      if (records && records.length > 0) {
        records.forEach(r => {
          if (r.type === 5) cnames.add(r.data);
        });
      }
    });

    if (cnames.size === 0) return 'N/A';
    return Array.from(cnames).join(', ');
  }

  async discoverSubdomains() {
    // Use Certificate Transparency logs (crt.sh) for real subdomain discovery.
    const rootDomain = this.getRootDomain();

    try {
      const response = await this.fetchWithTimeout(
        `https://crt.sh/?q=${rootDomain}&output=json`,
        { headers: { 'Accept': 'application/json' } },
        8000
      );

      if (!response.ok) return [];

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return [];

      // Extract unique subdomains from certificate entries.
      const uniqueSubs = new Set();
      data.forEach(entry => {
        const rawName = entry.name_value || '';
        // crt.sh can return multiple names separated by newlines.
        rawName.split('\n').forEach(name => {
          const clean = name.trim().toLowerCase();
          if (!clean || clean.startsWith('*.')) return;
          if (clean === rootDomain) return;
          if (clean.endsWith('.' + rootDomain)) {
            uniqueSubs.add(clean);
          }
        });
      });

      // Limit to first 15 unique subdomains to avoid overwhelming the UI/DNS.
      const candidates = Array.from(uniqueSubs).slice(0, 15);
      if (candidates.length === 0) return [];

      // Resolve each discovered subdomain to its A record (parallel with timeout).
      const results = await Promise.all(
        candidates.map(sub => this.resolveSubdomainIP(sub))
      );

      return results.filter(r => r !== null);
    } catch (_e) {
      return [];
    }
  }

  getRootDomain() {
    const parts = this.hostname.split('.');
    // If hostname is already a subdomain (e.g. blog.example.com), use the parent domain.
    if (parts.length >= 3) {
      return parts.slice(-2).join('.');
    }
    return this.hostname;
  }

  async resolveSubdomainIP(subdomain) {
    try {
      const response = await this.fetchWithTimeout(
        `https://dns.google/resolve?name=${subdomain}&type=A`,
        { headers: { 'Accept': 'application/dns-json' } },
        3000
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.Answer || data.Answer.length === 0) return null;

      const ips = data.Answer
        .filter(r => r.type === 1)
        .map(r => r.data)
        .join(', ');

      if (!ips) return null;

      return {
        subdomain: subdomain,
        type: 'A',
        value: ips
      };
    } catch (_e) {
      return null;
    }
  }

  static async load(url) {
    const dnsInfo = new DNSInfo(url);
    return await dnsInfo.getDNSInfo();
  }
}
