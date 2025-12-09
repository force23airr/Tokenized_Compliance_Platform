#!/usr/bin/env python3
"""
Retrain Trigger System

Monitors for breaking regulatory changes and triggers retraining notifications.
Prevents silent model drift by alerting when regulations change significantly.
"""

import os
import json
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"


@dataclass
class RetrainEvent:
    """Represents a retrain trigger event."""
    id: str
    timestamp: datetime
    source: str
    reason: str
    breaking_changes: List[Dict]
    severity: str  # low, medium, high, critical
    notified: bool = False
    resolved: bool = False

    def to_dict(self) -> Dict:
        d = asdict(self)
        d['timestamp'] = self.timestamp.isoformat()
        return d


class RetrainTrigger:
    """
    Monitors for regulatory changes that require model retraining.
    Sends notifications via Slack webhook or email.
    """

    BREAKING_CHANGE_KEYWORDS = [
        "amendment",
        "repeal",
        "new rule",
        "effective immediately",
        "threshold change",
        "definition change",
        "final rule",
        "supersedes",
        "revised",
    ]

    SEVERITY_KEYWORDS = {
        "critical": ["repeal", "effective immediately", "supersedes"],
        "high": ["amendment", "new rule", "definition change"],
        "medium": ["threshold change", "final rule", "revised"],
        "low": ["consultation", "proposed", "draft"],
    }

    def __init__(self):
        self.config = self._load_config()
        self.events_file = DATA_DIR / "retrain_events.json"
        self.flag_file = CONFIG_DIR / "retrain_required.flag"

    def _load_config(self) -> Dict:
        """Load notification configuration."""
        return {
            "slack_webhook_url": os.environ.get("SLACK_WEBHOOK_URL", ""),
            "alert_email": os.environ.get("ALERT_EMAIL", ""),
            "smtp_host": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "smtp_port": int(os.environ.get("SMTP_PORT", "587")),
            "smtp_user": os.environ.get("SMTP_USER", ""),
            "smtp_password": os.environ.get("SMTP_PASSWORD", ""),
            "enabled": os.environ.get("RETRAIN_NOTIFICATIONS_ENABLED", "true").lower() == "true",
        }

    def check_for_breaking_changes(self, updates: List[Dict]) -> List[Dict]:
        """Identify breaking changes from a list of regulatory updates."""
        breaking = []

        for update in updates:
            title = update.get("title", "").lower()
            summary = update.get("summary", "").lower()
            text = f"{title} {summary}"

            is_breaking = any(kw in text for kw in self.BREAKING_CHANGE_KEYWORDS)

            if is_breaking or update.get("is_breaking_change", False):
                breaking.append(update)

        return breaking

    def determine_severity(self, breaking_changes: List[Dict]) -> str:
        """Determine overall severity based on breaking changes."""
        if not breaking_changes:
            return "low"

        severities = []
        for change in breaking_changes:
            text = f"{change.get('title', '')} {change.get('summary', '')}".lower()

            for severity, keywords in self.SEVERITY_KEYWORDS.items():
                if any(kw in text for kw in keywords):
                    severities.append(severity)
                    break
            else:
                severities.append("medium")

        # Return highest severity
        severity_order = ["critical", "high", "medium", "low"]
        for sev in severity_order:
            if sev in severities:
                return sev

        return "medium"

    def set_retrain_flag(self, event: RetrainEvent) -> None:
        """Set flag file indicating retraining is required."""
        self.flag_file.parent.mkdir(parents=True, exist_ok=True)

        flag_data = {
            "retrain_required": True,
            "triggered_at": event.timestamp.isoformat(),
            "event_id": event.id,
            "reason": event.reason,
            "severity": event.severity,
        }

        with open(self.flag_file, 'w') as f:
            json.dump(flag_data, f, indent=2)

        logger.warning(f"Retrain flag set: {event.reason}")

    def clear_retrain_flag(self) -> None:
        """Clear the retrain flag after retraining is complete."""
        if self.flag_file.exists():
            self.flag_file.unlink()
            logger.info("Retrain flag cleared")

    def is_retrain_required(self) -> tuple[bool, Optional[Dict]]:
        """Check if retraining is currently required."""
        if not self.flag_file.exists():
            return False, None

        with open(self.flag_file, 'r') as f:
            data = json.load(f)

        return data.get("retrain_required", False), data

    def send_slack_notification(self, event: RetrainEvent) -> bool:
        """Send notification via Slack webhook."""
        if not self.config.get("slack_webhook_url"):
            logger.debug("Slack webhook not configured")
            return False

        severity_emoji = {
            "critical": ":rotating_light:",
            "high": ":warning:",
            "medium": ":information_source:",
            "low": ":memo:",
        }

        emoji = severity_emoji.get(event.severity, ":bell:")

        message = {
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": f"{emoji} AI Compliance Model Retrain Required",
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Severity:* {event.severity.upper()}"},
                        {"type": "mrkdwn", "text": f"*Source:* {event.source}"},
                        {"type": "mrkdwn", "text": f"*Time:* {event.timestamp.strftime('%Y-%m-%d %H:%M')}"},
                        {"type": "mrkdwn", "text": f"*Changes:* {len(event.breaking_changes)}"},
                    ]
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Reason:* {event.reason}",
                    }
                },
            ]
        }

        # Add breaking changes
        if event.breaking_changes:
            changes_text = "\n".join([
                f"• {c.get('title', 'Unknown')[:80]}"
                for c in event.breaking_changes[:5]
            ])
            message["blocks"].append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Breaking Changes:*\n{changes_text}",
                }
            })

        try:
            response = httpx.post(
                self.config["slack_webhook_url"],
                json=message,
                timeout=10.0,
            )
            response.raise_for_status()
            logger.info("Slack notification sent successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to send Slack notification: {e}")
            return False

    def send_email_notification(self, event: RetrainEvent) -> bool:
        """Send notification via email."""
        if not self.config.get("alert_email") or not self.config.get("smtp_user"):
            logger.debug("Email not configured")
            return False

        subject = f"[{event.severity.upper()}] AI Compliance Model Retrain Required"

        body = f"""
AI Compliance Model Retrain Alert
=================================

Severity: {event.severity.upper()}
Source: {event.source}
Time: {event.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
Event ID: {event.id}

Reason:
{event.reason}

Breaking Changes ({len(event.breaking_changes)}):
"""
        for change in event.breaking_changes[:10]:
            body += f"\n- {change.get('title', 'Unknown')}"
            if change.get('url'):
                body += f"\n  URL: {change.get('url')}"

        body += """

Action Required:
1. Review the regulatory changes
2. Update jurisdiction rules if needed
3. Regenerate training data
4. Trigger model retraining
5. Validate updated model
6. Clear retrain flag

This is an automated notification from the RWA Compliance Platform.
"""

        try:
            msg = MIMEMultipart()
            msg['From'] = self.config['smtp_user']
            msg['To'] = self.config['alert_email']
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            with smtplib.SMTP(self.config['smtp_host'], self.config['smtp_port']) as server:
                server.starttls()
                server.login(self.config['smtp_user'], self.config['smtp_password'])
                server.send_message(msg)

            logger.info("Email notification sent successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to send email notification: {e}")
            return False

    def trigger_retrain(
        self,
        source: str,
        reason: str,
        breaking_changes: List[Dict],
    ) -> RetrainEvent:
        """
        Trigger a retrain event:
        1. Set flag in config
        2. Send Slack notification
        3. Send email notification
        4. Log event for audit
        """
        severity = self.determine_severity(breaking_changes)

        event = RetrainEvent(
            id=f"rt_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            timestamp=datetime.now(),
            source=source,
            reason=reason,
            breaking_changes=breaking_changes,
            severity=severity,
        )

        # Set flag
        self.set_retrain_flag(event)

        # Send notifications if enabled
        if self.config.get("enabled"):
            slack_sent = self.send_slack_notification(event)
            email_sent = self.send_email_notification(event)
            event.notified = slack_sent or email_sent

        # Save event
        self.save_event(event)

        logger.warning(
            f"Retrain triggered: {event.reason} "
            f"(severity: {severity}, changes: {len(breaking_changes)})"
        )

        return event

    def save_event(self, event: RetrainEvent) -> None:
        """Save event to events log."""
        events = []
        if self.events_file.exists():
            with open(self.events_file, 'r') as f:
                events = json.load(f)

        events.append(event.to_dict())

        # Keep last 100 events
        events = events[-100:]

        with open(self.events_file, 'w') as f:
            json.dump(events, f, indent=2)

    def get_recent_events(self, limit: int = 10) -> List[Dict]:
        """Get recent retrain events."""
        if not self.events_file.exists():
            return []

        with open(self.events_file, 'r') as f:
            events = json.load(f)

        return events[-limit:]


def check_and_trigger(updates: List[Dict], source: str) -> Optional[RetrainEvent]:
    """
    Convenience function to check updates and trigger retrain if needed.
    Called by the daily update scheduler.
    """
    trigger = RetrainTrigger()

    breaking_changes = trigger.check_for_breaking_changes(updates)

    if not breaking_changes:
        logger.info(f"No breaking changes from {source}")
        return None

    reason = f"Detected {len(breaking_changes)} breaking regulatory change(s) from {source}"

    return trigger.trigger_retrain(
        source=source,
        reason=reason,
        breaking_changes=breaking_changes,
    )


if __name__ == "__main__":
    # Test with sample data
    sample_updates = [
        {
            "title": "SEC Announces Amendment to Accredited Investor Definition",
            "summary": "New threshold changes effective immediately",
            "url": "https://sec.gov/example",
            "is_breaking_change": True,
        }
    ]

    event = check_and_trigger(sample_updates, "SEC EDGAR")
    if event:
        print(json.dumps(event.to_dict(), indent=2))
