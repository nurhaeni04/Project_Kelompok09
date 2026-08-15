# Context Map War Tiket Konser


## Arsitektur Sistem


```mermaid
flowchart TD

User[User]

Mobile[Mobile Application]

Gateway[API Gateway :8080]

Event[event-service]

Ticket[ticket-service]

Payment[payment-service]

Notif[notification-service]


User --> Mobile

Mobile --> Gateway

Gateway --> Event

Gateway --> Ticket

Ticket --> Payment

Payment --> Notif