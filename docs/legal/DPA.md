# Data Processing Agreement (template)

This template DPA is provided for VigilAI customers. Replace with counsel-reviewed terms before production use.

## Parties

- **Controller**: Customer organization using VigilAI
- **Processor**: VigilAI (operator of this software)

## Scope

VigilAI processes host metrics, optional logs, alert metadata, account emails, and AI-generated summaries solely to provide monitoring services.

## Customer rights

- Export organization data via `GET /orgs/:id/export`
- Delete organization via `DELETE /orgs/:id` (owner)
- Contact support for assistance with deletion verification

## Subprocessors

- Cloud hosting provider (infrastructure)
- Optional LLM provider (OpenAI/Anthropic) when AI summaries enabled
- Optional Stripe (billing)
- Optional Slack (notifications)

## Security

- Agent tokens hashed at rest
- TLS in transit (production)
- Webhook SSRF protections
- Access audit logging for support actions

## Retention

Metrics and logs retained per plan limits; see product documentation.

*This document is a starting template, not legal advice.*
