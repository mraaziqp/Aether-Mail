#!/usr/bin/env python3
"""
Jarvis Autonomous Mail Protocol Daemon
Path: scripts/jarvis_autonomous_loop.py

Autonomous worker for Jarvis to monitor incoming emails across all business
mailboxes, analyze incident urgency, patch triage tags, and dispatch outbound
responses via Stalwart Mail Server.
"""

import os
import sys
import time
import json
import argparse
import urllib.request
import urllib.error

# Default Jarvis root key provisioned in AetherMail database
DEFAULT_JARVIS_KEY = os.environ.get(
    "JARVIS_ROOT_KEY",
    "jrv_root_cacac26f01beb8450ce0fba168b29099c7043e73f0578e5867f924e8ce1ea7c0"
)
DEFAULT_API_BASE = os.environ.get("AETHERMAIL_API_BASE", "http://localhost:3007/api/v1")


class JarvisMailAgent:
    def __init__(self, api_base: str = DEFAULT_API_BASE, token: str = DEFAULT_JARVIS_KEY):
        self.api_base = api_base.rstrip("/")
        self.token = token
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "Jarvis-Core-Autonomous-Agent/2.0"
        }

    def _request(self, method: str, endpoint: str, data: dict = None) -> dict:
        url = f"{self.api_base}{endpoint}"
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=self.headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                return json.loads(res_body)
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8")
            try:
                parsed = json.loads(err_body)
                return {"success": False, "http_status": err.code, "error": parsed.get("error", err_body)}
            except Exception:
                return {"success": False, "http_status": err.code, "error": err_body}
        except Exception as err:
            return {"success": False, "error": str(err)}

    def fetch_unread_triage(self, limit: int = 20) -> dict:
        """Pulls unread global emails across all business mailboxes."""
        return self._request("GET", f"/agent/triage?unread_only=true&limit={limit}")

    def triage_email(self, email_id: str, category: str = "work", ai_summary: str = None, requires_alert: bool = False, is_read: bool = True) -> dict:
        """Patches an email record with triage classification and marks as read/handled."""
        payload = {
            "email_id": email_id,
            "category": category,
            "requires_alert": requires_alert,
            "is_read": is_read
        }
        if ai_summary:
            payload["ai_summary"] = ai_summary
        return self._request("PATCH", "/agent/triage", payload)

    def dispatch_email(self, to: str, subject: str, html_body: str, from_addr: str = None, reply_to: str = None) -> dict:
        """Dispatches an outbound email via Stalwart SMTP relay."""
        payload = {
            "to": to,
            "subject": subject,
            "htmlBody": html_body,
        }
        if from_addr:
            payload["from"] = from_addr
        if reply_to:
            payload["replyTo"] = reply_to

        return self._request("POST", "/agent/dispatch", payload)

    def run_triage_cycle(self) -> int:
        """Executes a single triage and threat inspection loop."""
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Jarvis checking global triage inbox...")
        result = self.fetch_unread_triage()

        if not result.get("success"):
            print(f"❌ Jarvis triage check failed: {result.get('error')}")
            return 0

        emails = result.get("emails", [])
        total = len(emails)
        print(f"📥 Jarvis identified {total} unread message(s) across mailboxes.")

        for em in emails:
            msg_id = em.get("id")
            sender = em.get("sender")
            subject = em.get("subject")
            category = em.get("category")
            requires_alert = em.get("requires_alert")
            print(f"   ↳ [ID: {msg_id}] From: {sender} | Subj: {subject} | Cat: {category} | P0 Alert: {requires_alert}")

        return total


def main():
    parser = argparse.ArgumentParser(description="Jarvis Autonomous Mail Protocol Agent")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="AetherMail v1 API URL base")
    parser.add_argument("--token", default=DEFAULT_JARVIS_KEY, help="Jarvis root API key (jrv_root_...)")
    parser.add_argument("--once", action="store_true", help="Run a single triage sweep and exit")
    parser.add_argument("--interval", type=int, default=30, help="Poll interval in seconds (default: 30)")
    parser.add_argument("--send-test", action="store_true", help="Send a test dispatch email via Stalwart")
    parser.add_argument("--to", default="admin@example.com", help="Recipient for test send")

    args = parser.parse_args()
    agent = JarvisMailAgent(api_base=args.api_base, token=args.token)

    print("=" * 60)
    print("🤖 Jarvis Autonomous Mail Protocol Engine Active")
    print(f"📡 API Endpoint: {agent.api_base}")
    print(f"🔑 Root Key: {agent.token[:12]}...{agent.token[-6:]}")
    print("=" * 60)

    if args.send_test:
        print(f"🚀 Dispatching test transmission to {args.to}...")
        res = agent.dispatch_email(
            to=args.to,
            subject="[AUTONOMOUS] Jarvis Protocol Initialized",
            html_body="<p>Jarvis Root Protocol operational. Stalwart SMTP dispatch link confirmed.</p>"
        )
        print("Dispatch Result:", json.dumps(res, indent=2))
        return

    if args.once:
        agent.run_triage_cycle()
        return

    print(f"🔄 Starting autonomous monitoring loop (every {args.interval}s). Press Ctrl+C to stop.")
    try:
        while True:
            agent.run_triage_cycle()
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n🛑 Jarvis monitoring daemon stopped by user.")


if __name__ == "__main__":
    main()
