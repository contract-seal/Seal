**SEAL**

Artisan Escrow + Invoice Platform

**Full System Technical Specification**

For Engineering · Product · Hackathon Build

Version 1.0 · Money in Motion Hackathon · M-Pesa Africa + GOMYCODE Kenya

**1. System Overview**
======================

Fundi Pay is a mobile-first escrow and invoicing platform built for
Kenya\'s 2.4 million jua kali (informal sector) artisans --- carpenters,
welders, tailors, painters, and plumbers --- who currently operate
without contracts, payment protection, or financial identity. The
platform sits on top of M-Pesa\'s Daraja API and uses three primitives:
C2B Paybill (client pays deposit into escrow), STK Push (prompt client
for balance payment), and B2C (disburse payout to artisan wallet).

**1.1 The Problem Statement**
-----------------------------

Two failure modes destroy value for artisans every day:

-   **Client disappears after delivery.** Artisan completes a Ksh 12,000
    cabinet, client refuses to pay or cannot be reached. No contract
    exists. No legal recourse. Artisan absorbs the loss.

-   **Artisan takes deposit and vanishes.** Client pays Ksh 6,000
    upfront for a welding job. Artisan disappears. Client has no record
    and no way to recover the money.

Fundi Pay eliminates both failure modes with one mechanism: an
M-Pesa-backed escrow wallet that holds money in a neutral position until
both parties confirm the job is complete.

**1.2 Platform Architecture Summary**
-------------------------------------

The system is composed of 9 backend services, 4 client interfaces, and 3
external API integrations. Services communicate via two channels:

-   **Synchronous HTTP** (REST) for user-facing requests that require an
    immediate response --- creating a job, checking a balance,
    submitting delivery.

-   **Asynchronous events** (Redis Streams pub-sub) for actions that
    trigger side effects in other services --- a confirmed payment
    triggers ledger credit, which triggers credit score recalculation,
    which triggers notification dispatch.

+----------------------------------------------------------------------+
| **Core Principle: The escrow ledger is append-only.**                |
|                                                                      |
| No balance is ever stored as a single number. Every credit and debit |
| is recorded as an immutable row in the escrow\_ledger table. The     |
| current balance is always computed as SUM(credits) - SUM(debits).    |
| This guarantees auditability, prevents corruption bugs, and makes    |
| dispute resolution trivial.                                          |
+----------------------------------------------------------------------+

**2. Client Interfaces**
========================

Four interfaces serve different users. All interfaces route through the
same API Gateway --- there is no interface-specific backend logic.

**2.1 Artisan Progressive Web App (PWA)**
-----------------------------------------

### **Purpose and users**

The primary interface for artisans (carpenters, welders, tailors, etc.)
to create job quotes, track escrow status, submit delivery evidence, and
view their payment history and reputation score. Built as a PWA so it
installs on Android without an app store and works on low-end devices.

### **Key screens and behaviour**

-   **Home dashboard:** Shows active jobs with escrow balances, pending
    approvals, and total earned this month. Pulls from Job Service and
    Ledger Service via GET /api/artisan/dashboard.

-   **Create quote:** Artisan fills in client phone number, job title,
    description, total price, and deadline. Optional: add up to 5
    milestones with individual amounts. On submit, Job Service creates a
    DRAFT job and sends the quote link to the client via WhatsApp and
    SMS.

-   **Active job view:** Shows real-time escrow balance (deposit
    received or not), job timeline, milestone status, and delivery
    upload button. WebSocket connection to receive live payment events.

-   **Submit delivery:** Artisan uploads 1--4 photos and a text note via
    POST /api/jobs/{id}/deliver. Photos stored in S3. Client is notified
    immediately via WhatsApp with an approval card.

-   **Reputation card:** Shows score (0--100), completed jobs count,
    on-time rate, average client rating, and loan eligibility status.

### **USSD fallback --- \*384\*FUNDI\#**

Artisans without smartphones dial the Africa\'s Talking USSD shortcode.
The USSD Service provides a text menu covering: check escrow balance,
confirm job completion, check reputation score, and receive OTP for
login. USSD sessions have a 90-second TTL stored in Redis.

**2.2 Client PWA**
------------------

### **Purpose and users**

The interface for clients (homeowners, businesses) who hire artisans.
Clients receive a job quote via SMS or WhatsApp link --- they do not
need to have the app pre-installed. The link opens the PWA in their
browser with the job pre-loaded.

### **Key screens and behaviour**

-   **Quote review:** Client sees job title, description, total price,
    milestones (if any), artisan name, reputation score, and an
    ID-verified badge. They can accept or reject the quote.

-   **Deposit payment:** On acceptance, client is prompted to pay 50%
    deposit. The system sends an STK Push to their phone. If STK fails
    (network issue or declined), client sees a Paybill fallback --- pay
    manually using Job Reference code as account number.

-   **Job tracking:** Client sees job status, artisan\'s milestone
    updates, and a countdown to deadline.

-   **Delivery approval:** When artisan submits delivery, client
    receives a WhatsApp message with photo thumbnails and two buttons:
    Approve (triggers STK Push for balance) and Dispute (opens dispute
    form). The same options appear in the PWA. A 48-hour countdown is
    displayed --- if the client takes no action, the job auto-approves
    and payout fires.

-   **Dispute form:** Client selects a reason (work incomplete, wrong
    materials, quality issues, other), writes a description, and can
    upload counter-evidence photos. This transitions the job to DISPUTED
    state and freezes escrow.

**2.3 Admin Portal**
--------------------

### **Purpose and users**

Web-only portal for Fundi Pay platform administrators. Used for
onboarding new artisans, reviewing disputed jobs, managing the loan
float account, and viewing platform-wide analytics.

### **Key functions**

-   **Artisan onboarding:** Approve or reject artisan applications. View
    IPRS ID verification results. Set artisan tier (standard, trusted,
    verified).

-   **Dispute resolution queue:** See all jobs in DISPUTED state sorted
    by age. View both parties\' evidence side by side. Issue resolution:
    release to artisan, refund client, or split. A 72-hour SLA applies
    --- if no admin action, system auto-refunds client in full.

-   **Float management:** View escrow float balance in the M-Pesa
    Paybill account. Trigger reconciliation reports. Set maximum
    individual job escrow size.

-   **Analytics:** Daily collection volume, active jobs, dispute rate,
    average job value, artisan activity by county, and loan default
    rate.

**2.4 WhatsApp Bot**
--------------------

### **Purpose and users**

A WhatsApp Business API bot that handles the most time-sensitive
interactions without requiring the client or artisan to open the PWA. It
uses interactive message templates with button replies.

### **Interactions handled by WhatsApp bot**

-   **Quote notification to client:** Artisan creates quote → bot sends
    client a rich card with job details, artisan\'s name and score,
    total price, and two buttons: \"Accept quote\" and \"Decline
    quote\". Reply is captured via webhook and forwarded to Job Service.

-   **Delivery approval card:** Artisan submits delivery → bot sends
    client a card with photo thumbnails, delivery note, and \"Approve\"
    / \"Raise dispute\" buttons. This is the primary approval pathway
    --- most clients will use this rather than the PWA.

-   **Payment receipt:** After any M-Pesa payment event, bot sends
    formatted receipt to both parties: amount, M-Pesa reference, job
    name, escrow balance remaining.

-   **Dispute status updates:** Both parties receive status updates as
    admin progresses through dispute resolution.

**3. API Gateway and Authentication Service**
=============================================

**3.1 Role and Responsibilities**
---------------------------------

The API Gateway is the single entry point for all HTTP and WebSocket
traffic. No client interface communicates directly with any backend
service --- all requests pass through the gateway. The gateway is
responsible for:

-   Authentication --- validating JWT tokens on every request

-   Routing --- forwarding authenticated requests to the correct backend
    service

-   Rate limiting --- per-phone-number and per-IP limits to prevent
    abuse

-   Request logging --- structured JSON logs for every request,
    including latency and upstream service response code

-   Webhook passthrough --- M-Pesa callback URLs bypass JWT
    authentication but are validated against Safaricom\'s published IP
    whitelist (196.201.214.x range)

**3.2 Authentication Design**
-----------------------------

There are no passwords in Fundi Pay. Phone number is identity.
Authentication works as follows:

1.  User submits their phone number to POST /auth/otp/request

2.  Gateway calls Africa\'s Talking SMS API to send a 6-digit OTP with a
    10-minute expiry, stored in Redis with key otp:{phone}

3.  User submits OTP to POST /auth/otp/verify. Gateway validates against
    Redis value, deletes it on match (one-time use)

4.  Gateway issues a signed JWT (RS256) containing: user ID, phone, role
    (artisan \| client \| admin), and issued-at timestamp. Expiry: 24
    hours for mobile, 8 hours for admin portal

5.  All subsequent requests include the JWT in the Authorization: Bearer
    header. Gateway validates signature and checks the token is not in
    the Redis blacklist (jwt\_blacklist:{jti})

6.  On logout, the JWT\'s jti (unique token ID) is added to the Redis
    blacklist with TTL matching token remaining validity

**3.3 Rate Limiting**
---------------------

  -------------------- --------------- ----------------------
  **Endpoint Group**   **Limit**       **Window**
  OTP request          5 requests      per phone per hour
  Authenticated API    300 requests    per token per hour
  M-Pesa webhooks      No limit        (Safaricom IP only)
  Admin portal         1000 requests   per session per hour
  -------------------- --------------- ----------------------

**4. User Service**
===================

**4.1 Responsibility**
----------------------

The User Service owns all artisan and client profile data. It is the
authority on who a user is, what their verified identity is, what tier
they hold, and whether they are eligible to create jobs or apply for
loans. Every other service that needs user data calls the User Service
--- no service reads the users table directly.

**4.2 Artisan Onboarding Flow**
-------------------------------

Artisans go through a one-time verification before they can create jobs:

7.  Artisan submits name, phone, national ID number, trade (carpenter,
    welder, tailor, etc.), and county

8.  User Service calls the IPRS (Integrated Population Registration
    System) API with the national ID number to verify name match

9.  If IPRS match passes, artisan record is created with status:
    pending\_approval

10. Admin portal displays the application. Admin reviews and approves or
    rejects

11. On approval, artisan receives SMS confirmation and their profile is
    activated. They can now create job quotes

Clients do not require verification --- they are created automatically
the first time an artisan sends them a quote. Client identity is their
phone number.

**4.3 API Endpoints**
---------------------

  ------------------------------------ ------------ --------------------------------------------
  **Endpoint**                         **Method**   **Description**
  /api/users/artisan/apply             POST         Submit artisan application with ID details
  /api/users/{id}                      GET          Fetch user profile (self or admin only)
  /api/users/{id}/tier                 PUT          Update artisan tier (admin only)
  /api/users/artisan/{id}/reputation   GET          Get reputation score and history
  /api/users/clients/{phone}           GET          Look up client by phone (artisan use)
  ------------------------------------ ------------ --------------------------------------------

**4.4 Events Published**
------------------------

-   user.artisan.approved --- Published when admin approves an artisan.
    Consumed by Notification Service (sends welcome SMS).

-   user.artisan.rejected --- Published when admin rejects an
    application. Consumed by Notification Service (sends rejection SMS
    with reason).

**4.5 Integration Points**
--------------------------

-   **Calls IPRS API:** On artisan application, synchronous call to
    verify national ID. If IPRS is unavailable, application is queued
    with status pending\_iprs\_check and retried every 30 minutes for up
    to 24 hours.

-   **Called by Job Service:** Job Service calls GET /api/users/{id} to
    validate that both artisan and client exist and artisan status is
    active before creating a job.

-   **Called by Loan Service:** Loan Service calls GET
    /api/users/artisan/{id}/reputation to check credit score before
    approving a loan application.

**5. Job Service**
==================

**5.1 Responsibility**
----------------------

The Job Service manages the complete lifecycle of a job --- from initial
quote through active work, delivery, approval, and completion. It is the
owner of job state and the orchestrator that triggers other services as
jobs progress through states. Every state transition in the job
lifecycle results in at least one event published to the event bus.

**5.2 Job States and Transitions**
----------------------------------

A job moves through 7 possible states. The transitions between states
are the most critical logic in the system --- each transition has a
guard condition that must pass before the transition is allowed, and a
set of actions (API calls or events) that fire when the transition
succeeds.

  ------------------- -------------------------------------------- --------------------------------- --------------------------------------------------------------------
  **State**           **Guard condition**                          **Trigger**                       **Actions on entry**
  DRAFT               Artisan is active, client phone valid        Artisan creates quote             Send quote notification to client
  AWAITING\_DEPOSIT   Client accepted quote                        client.accepted event             Initiate STK Push for 50% deposit; start 72hr expiry timer
  ACTIVE              Deposit payment confirmed in escrow          payment.deposit.confirmed         Notify artisan to begin work; log escrow credit
  PENDING\_APPROVAL   Artisan uploaded delivery evidence           artisan.delivered                 Notify client via WhatsApp + SMS; start 48hr approval timer
  DISPUTED            Client raised dispute before timer expired   client.disputed                   Freeze escrow; open dispute case; notify admin
  RELEASING           Client approved OR 48hr timer expired        client.approved / timer.expired   Initiate STK Push for balance 50%; on confirm, fire B2C payout
  COMPLETE            B2C payout confirmed by Daraja               b2c.payout.confirmed              Update reputation score; prompt both parties to rate; close escrow
  CANCELLED           72hr deposit timer expired with no payment   timer.deposit\_expired            Notify both parties; no financial action required
  ------------------- -------------------------------------------- --------------------------------- --------------------------------------------------------------------

+----------------------------------------------------------------------+
| **Important: The 48-hour auto-approve rule**                         |
|                                                                      |
| When a job enters PENDING\_APPROVAL, a BullMQ delayed job is         |
| scheduled for exactly 48 hours. If the client approves before the    |
| timer fires, the delayed job is cancelled. If the timer fires first, |
| the system calls approveDelivery() on behalf of the client and sends |
| them an SMS explaining the auto-approval. This removes the           |
| artisan\'s biggest risk: being ghosted after delivering work.        |
+----------------------------------------------------------------------+

**5.3 Milestone Handling**
--------------------------

Milestones are optional sub-tasks within a job, each with a defined
amount. When milestones are present, the escrow mechanics change
slightly:

-   The 50% deposit still applies to the total job value and is locked
    in escrow on job acceptance

-   As the artisan completes and the client approves each milestone, the
    corresponding milestone amount is released from escrow via B2C ---
    partial payout before final delivery

-   The final balance is paid on overall job completion as normal

-   If a dispute is raised mid-job, only the unreleased escrow amount is
    frozen --- already-released milestone payments are not clawed back

**5.4 API Endpoints**
---------------------

  ----------------------------------------- ------------ --------------------------------------------------
  **Endpoint**                              **Method**   **Description**
  /api/jobs/quote                           POST         Create new job quote (artisan only)
  /api/jobs/{id}                            GET          Get job details and current state
  /api/jobs/{id}/accept                     POST         Client accepts quote, triggers STK Push
  /api/jobs/{id}/decline                    POST         Client declines quote, job cancelled
  /api/jobs/{id}/milestones                 PUT          Set or update milestones (artisan)
  /api/jobs/{id}/milestone/{mid}/complete   POST         Mark milestone complete, request partial release
  /api/jobs/{id}/deliver                    POST         Submit delivery evidence (photos + note)
  /api/jobs/{id}/approve                    POST         Client approves delivery, triggers payment
  /api/jobs/{id}/dispute                    POST         Client raises dispute with evidence
  /api/artisan/jobs                         GET          List all jobs for authenticated artisan
  /api/client/jobs                          GET          List all jobs for authenticated client
  ----------------------------------------- ------------ --------------------------------------------------

**5.5 Events Published**
------------------------

-   job.created --- Consumed by Notification Service (quote SMS/WhatsApp
    to client).

-   job.accepted --- Consumed by Payment Service (initiate STK Push for
    deposit).

-   job.delivered --- Consumed by Notification Service (approval card to
    client); Scheduler (start 48hr timer).

-   job.approved --- Consumed by Payment Service (initiate balance STK
    Push).

-   job.completed --- Consumed by Reputation Service (update artisan
    score); Notification Service (completion receipt).

-   job.disputed --- Consumed by Dispute Service (open case);
    Notification Service (alert admin).

**6. Payment Service**
======================

**6.1 Responsibility**
----------------------

The Payment Service is the exclusive interface to M-Pesa Daraja API. No
other service makes direct HTTP calls to Daraja. The Payment Service
wraps three Daraja primitives, handles all webhook callbacks from
Safaricom, and publishes clean payment events to the event bus for other
services to consume. It is responsible for idempotency --- ensuring a
payment that is confirmed twice (Safaricom occasionally retries
callbacks) is only credited once.

**6.2 The Three M-Pesa Primitives**
-----------------------------------

### **C2B Paybill --- client-initiated deposit**

When a client pays using standard M-Pesa USSD (\*150\*01\#) or the
M-Pesa app, they navigate to Lipa na M-Pesa \> Paybill and enter:

-   **Business number:** The Fundi Pay Paybill number registered with
    Safaricom via Daraja RegisterURL.

-   **Account number:** The job reference code (e.g., JOB-A7K92). This
    is how the Payment Service identifies which job the payment is for.

-   **Amount:** Any amount --- the system accepts partial payments and
    tracks running balance toward the 50% deposit requirement.

Safaricom calls our ConfirmationURL with the payment details. The
Payment Service validates the Safaricom source IP, records the
transaction with the M-Pesa TransID as a unique key, and publishes
payment.c2b.confirmed to the event bus.

### **STK Push --- system-initiated payment prompt**

Used in two scenarios: prompting the client to pay their 50% deposit
when they accept a quote (more convenient than manual Paybill), and
prompting the client to pay the 50% balance when they approve delivery.
The system calls Daraja STK Push with the client\'s phone number and the
amount. The client sees an M-Pesa prompt on their phone and enters their
PIN. Safaricom calls our STK callback URL with the result. If the client
declines or the prompt times out, the system retries once after 10
minutes and then falls back to a Paybill reminder SMS.

### **B2C --- artisan payout**

After balance payment is confirmed, the Payment Service calls Daraja B2C
to transfer the full escrow amount (minus the 2.5% platform fee)
directly to the artisan\'s M-Pesa wallet. Daraja processes the transfer
and calls our B2C ResultURL. On success, payment.b2c.confirmed is
published. The platform fee (2.5% of job value) is retained in the
Paybill float account and swept to the Fundi Pay bank account weekly.

**6.3 Idempotency**
-------------------

The payments table has a UNIQUE constraint on the mpesa\_ref column
(M-Pesa TransID). If Safaricom delivers the same callback twice, the
second INSERT fails silently --- the payment is not double-credited. The
callback always returns ResultCode: 0 (success) regardless, so Safaricom
stops retrying.

**6.4 Webhook Validation**
--------------------------

All Daraja webhook endpoints validate that the incoming request
originates from Safaricom\'s published IP range (196.201.214.0/24 and
196.201.216.0/24). Requests from other IPs are rejected with HTTP 403.
JWT authentication is bypassed on webhook routes --- Safaricom does not
send auth headers.

**6.5 API Endpoints**
---------------------

  ----------------------------- ------------ ---------------------------------------------------
  **Endpoint**                  **Method**   **Description**
  /webhook/mpesa/validation     POST         Safaricom pre-payment validation (verify account)
  /webhook/mpesa/confirmation   POST         Safaricom C2B payment confirmed callback
  /webhook/mpesa/stk-callback   POST         Safaricom STK Push result callback
  /webhook/mpesa/b2c-result     POST         Safaricom B2C payout result callback
  /api/payments/stk-push        POST         Initiate STK Push (internal service use)
  /api/payments/b2c             POST         Initiate B2C payout (internal service use)
  /api/payments/{mpesa\_ref}    GET          Look up a payment by M-Pesa reference
  ----------------------------- ------------ ---------------------------------------------------

**6.6 Events Published**
------------------------

-   payment.deposit.confirmed --- C2B webhook received and validated.
    Consumed by Escrow Engine (credit ledger) and Job Service
    (transition to ACTIVE).

-   payment.balance.confirmed --- STK callback success for balance
    payment. Consumed by Escrow Engine and Job Service (transition to
    RELEASING).

-   payment.b2c.confirmed --- B2C payout delivered to artisan. Consumed
    by Job Service (transition to COMPLETE) and Reputation Service.

-   payment.stk.failed --- STK Push declined or timed out. Consumed by
    Notification Service (send Paybill fallback SMS to client) and
    Scheduler (queue retry).

**7. Escrow Engine**
====================

**7.1 Responsibility**
----------------------

The Escrow Engine is the financial core of Fundi Pay. It maintains the
append-only escrow\_ledger, computes balances, manages the Redis lock
that prevents double-spend during concurrent state transitions, and
executes the release logic that determines how much of the escrow goes
to the artisan and how much (if any) is refunded to the client.

**7.2 Ledger Design**
---------------------

The escrow\_ledger table has no balance column. Every monetary movement
--- deposit received, milestone released, balance received, payout to
artisan, refund to client --- is recorded as an individual row with a
type (credit or debit) and an amount in Kenyan shillings (stored as
integer cents to avoid floating-point errors). The current escrow
balance for any job is computed as:

> SELECT
>
> SUM(CASE WHEN type = \'credit\' THEN amount ELSE 0 END) -
>
> SUM(CASE WHEN type = \'debit\' THEN amount ELSE 0 END) AS
> escrow\_balance
>
> FROM escrow\_ledger
>
> WHERE job\_id = \$1;

**7.3 Concurrency Lock**
------------------------

When a payment event arrives (deposit or balance), the Escrow Engine
acquires a Redis lock keyed to the job ID (escrow:lock:{job\_id}) before
performing any ledger write or state transition. The lock has a 5-second
TTL. If the lock cannot be acquired within 2 seconds, the operation is
queued for retry. This prevents a rare but possible scenario where two
payment callbacks arrive simultaneously for the same job and both try to
credit the escrow.

**7.4 Release Scenarios**
-------------------------

  ------------------------------------ ------------------------------------------------- ------------------------------------------------
  **Scenario**                         **Escrow action**                                 **M-Pesa call**
  Client approves delivery             Full balance released to artisan minus 2.5% fee   B2C: artisan receives 97.5% of total job value
  48hr auto-approve fires              Same as client approval above                     B2C: artisan receives 97.5% of total job value
  Dispute: resolved for artisan        Full or partial release to artisan                B2C: artisan receives admin-specified amount
  Dispute: resolved for client         Full or partial refund to client                  B2C: client refund to M-Pesa wallet
  72hr no admin response               Full escrow refunded to client                    B2C: full refund to client
  Deposit timer expired (no payment)   Nothing in escrow --- no action                   None
  ------------------------------------ ------------------------------------------------- ------------------------------------------------

**8. Dispute Service**
======================

**8.1 Responsibility**
----------------------

The Dispute Service manages the evidence-gathering and resolution
workflow for jobs that enter the DISPUTED state. It operates as a
structured case management system visible to admins, with a hard 72-hour
resolution SLA.

**8.2 Dispute Workflow**
------------------------

12. Client raises dispute via POST /api/jobs/{id}/dispute, providing a
    reason and optional evidence photos

13. Dispute Service creates a dispute record and publishes job.disputed
    to the event bus

14. Job Service transitions the job to DISPUTED state. Escrow Engine
    freezes the balance

15. Notification Service alerts both parties that a dispute is open and
    explains the 72-hour timeline

16. Notification Service alerts admin queue that a new dispute needs
    review

17. Both parties can upload additional evidence via POST
    /api/disputes/{id}/evidence. Photos are stored in S3 and URL
    recorded in the evidence\_urls array on the dispute record

18. Admin reviews evidence in the Admin Portal and submits a resolution
    via POST /api/disputes/{id}/resolve specifying: resolution type
    (artisan\_full \| client\_full \| split), split\_artisan\_pct (if
    split), and a written resolution note that is sent to both parties

19. Escrow Engine executes the release based on the admin\'s resolution.
    B2C calls fire for the relevant parties

20. If 72 hours pass with no admin action, a BullMQ job fires that
    auto-resolves in favour of the client with a full refund

**8.3 Evidence Rules**
----------------------

-   Artisan evidence: delivery photos submitted at time of POST
    /api/jobs/{id}/deliver are automatically attached to any subsequent
    dispute. No re-upload needed

-   Maximum 4 photos per party, JPEG or PNG, max 5MB each

-   Photos are stored privately in S3 and served via time-limited signed
    URLs (1-hour expiry) generated fresh each time the admin opens the
    dispute

**9. Reputation Service**
=========================

**9.1 Responsibility**
----------------------

The Reputation Service builds and maintains a 0--100 reputation score
for every artisan. The score is updated after every completed job and
drives two important platform functions: client trust (displayed on
quote cards) and loan eligibility (minimum score of 50 required to
apply).

**9.2 Score Calculation**
-------------------------

The score is a weighted composite of four factors:

  ------------------------- ------------ ----------------------------------------------------------------------
  **Factor**                **Weight**   **Definition**
  On-time delivery rate     35%          Jobs delivered on or before deadline / total jobs
  Dispute rate (inverted)   30%          1 - (disputed jobs / total jobs). Lower disputes = higher score
  Average client rating     25%          Mean of all post-job star ratings (1--5 scale, normalised to 0--100)
  History depth             10%          Log-scaled completed job count. Caps at 50 jobs (full 10 points)
  ------------------------- ------------ ----------------------------------------------------------------------

The score is recomputed from scratch after each completed job --- not
incrementally updated. This avoids accumulated rounding errors and makes
the formula easy to audit. Score history (one row per computation) is
retained indefinitely.

**9.3 Score Tiers and Privileges**
----------------------------------

  ---------- ----------------- ----------------- --------------------------------------------------------
  **Tier**   **Score range**   **Label shown**   **Privileges**
  New        0--29             New artisan       Max job value: Ksh 10,000. No loan access
  Standard   30--59            Verified fundi    Max job value: Ksh 50,000. Loan access unlocked
  Trusted    60--84            Trusted fundi     Max job value: Ksh 200,000. Priority dispute handling
  Elite      85--100           Elite fundi       No cap. Featured placement. Lowest platform fee (1.5%)
  ---------- ----------------- ----------------- --------------------------------------------------------

**10. Scheduler Service**
=========================

**10.1 Responsibility**
-----------------------

The Scheduler Service manages all time-based events in the system. It
runs BullMQ job queues backed by Redis. Every timer in the system ---
deposit expiry, delivery approval countdown, dispute resolution
deadline, loan repayment dates --- is a BullMQ delayed job, not a
database polling cron. This means timers fire exactly on time even if
the server was restarted between scheduling and execution.

**10.2 Scheduled Jobs**
-----------------------

  ------------------------ ----------------------------- ------------------------------ ------------------------------------------------------
  **Job name**             **Delay**                     **Trigger**                    **Action on fire**
  deposit.expiry           72 hours                      Job enters AWAITING\_DEPOSIT   Cancel job, notify both parties
  delivery.auto\_approve   48 hours                      Job enters PENDING\_APPROVAL   Call approveDelivery() on behalf of client
  dispute.admin\_sla       72 hours                      Job enters DISPUTED            Auto-refund client in full, close dispute
  stk.retry                10 minutes                    STK Push declined              Retry STK Push once; on 2nd failure send Paybill SMS
  loan.repayment\_due      Configured at loan creation   Loan disbursed                 Trigger STK Push for repayment instalment
  platform.fee\_sweep      Weekly (Monday 08:00 EAT)     Cron                           Compute and log platform fees from completed jobs
  ------------------------ ----------------------------- ------------------------------ ------------------------------------------------------

**10.3 Timer Cancellation**
---------------------------

When a state transition makes a timer irrelevant --- for example, the
client approves delivery before the 48-hour auto-approve fires --- the
pending BullMQ job must be cancelled. Each timer job ID is stored in the
jobs table (deposit\_expiry\_job\_id, approval\_timer\_job\_id columns)
at scheduling time. The Job Service cancels the relevant BullMQ job by
ID when a superseding event arrives.

**11. Notification Service**
============================

**11.1 Responsibility**
-----------------------

The Notification Service is the centralised outbound messaging hub. It
subscribes to events from every other service and dispatches the
appropriate message to the appropriate channel (SMS or WhatsApp). It
owns all message templates, tracks delivery status, and retries failed
messages up to 3 times with exponential backoff.

**11.2 Message Templates**
--------------------------

  ------------------------------ -------------------- ------------------------------------------------------------------------------------------------
  **Trigger event**              **Channel**          **Message content**
  job.created                    WhatsApp + SMS       Quote card to client: artisan name, score, job title, price. Accept/Decline buttons (WhatsApp)
  payment.deposit.confirmed      SMS (both)           Receipt: amount, M-Pesa ref, job name, escrow balance. Artisan told to begin work
  job.delivered                  WhatsApp + SMS       Approval card to client: photo thumbnails, note, 48hr countdown, Approve/Dispute buttons
  job.disputed                   SMS (both) + admin   Both parties informed of dispute open. Admin alerted to review queue
  job.completed                  SMS (both)           Receipt: total amount, M-Pesa ref for artisan payout. Rating request link
  payment.stk.failed             SMS (client)         Paybill fallback: pay Ksh {amount} to Paybill {number}, account: JOB-{ref}
  delivery.auto\_approve fired   SMS (client)         Auto-approved: 48hr window expired. Artisan has been paid. Rate your experience
  dispute resolved               SMS (both)           Resolution outcome + reason + amounts. B2C receipt where applicable
  ------------------------------ -------------------- ------------------------------------------------------------------------------------------------

**11.3 Delivery Tracking and Retry**
------------------------------------

Every outbound message gets a row in the notifications table with
status: queued. Africa\'s Talking delivery receipts update the status to
delivered or failed. Failed messages are retried up to 3 times at 2, 10,
and 30 minute intervals using BullMQ. After 3 failures, status is set to
permanently\_failed and an alert is logged for the ops team. WhatsApp
delivery failures automatically fall back to SMS.

**12. USSD Service**
====================

**12.1 Responsibility**
-----------------------

The USSD Service handles all Africa\'s Talking USSD sessions for the
\*384\*FUNDI\# shortcode. It manages menu state per session, processes
user input, calls other services for data, and returns the correct
Africa\'s Talking response format (CON for continuing session, END for
terminal response).

**12.2 Menu Tree**
------------------

> \*384\*FUNDI\# → Main menu
>
> 1\. Check escrow balance
>
> → Enter job reference: JOB-XXXXX
>
> → CON: Job: {title} \| Escrow: Ksh {balance} \| State: {state}
>
> 2\. Confirm job delivery (artisan only)
>
> → Enter job reference
>
> → CON: Confirm delivery for {job}? 1=Yes 2=No
>
> → END: Delivery submitted. Client has 48hrs to approve.
>
> 3\. Check my reputation score
>
> → END: Score: {n}/100 ({tier}) \| Jobs: {count} \| On-time: {pct}%
>
> 4\. Approve delivery (client only)
>
> → Enter job reference
>
> → CON: Approve {artisan} work on {job}? Ksh {balance} will be charged.
>
> → 1=Approve (STK Push sent) 2=Cancel
>
> 0\. Exit

**12.3 Session State**
----------------------

Each USSD session is assigned a sessionId by Africa\'s Talking. The USSD
Service stores the current menu position and any collected inputs in
Redis using key ussd:session:{sessionId} with a 90-second TTL. Africa\'s
Talking calls the callback URL on every user keypress. The service reads
the session state, processes the input, and returns the next menu
screen.

**13. Database Schema**
=======================

All tables are in PostgreSQL. Timestamps are stored in UTC. Monetary
amounts are stored as integers representing Kenyan shillings × 100
(i.e., Ksh 12,500 stored as 1250000) to avoid floating-point arithmetic
errors.

**13.1 users**
--------------

> CREATE TABLE users (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> phone TEXT UNIQUE NOT NULL,
>
> name TEXT NOT NULL,
>
> role TEXT NOT NULL CHECK (role IN (\'artisan\',\'client\',\'admin\')),
>
> national\_id TEXT,
>
> iprs\_verified BOOLEAN DEFAULT false,
>
> status TEXT DEFAULT \'pending\', \-- pending\|active\|suspended
>
> trade TEXT, \-- carpenter\|welder\|tailor\|painter\|other
>
> county TEXT,
>
> tier TEXT DEFAULT \'new\', \-- new\|standard\|trusted\|elite
>
> created\_at TIMESTAMPTZ DEFAULT NOW()
>
> );

**13.2 jobs**
-------------

> CREATE TABLE jobs (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> ref\_code TEXT UNIQUE NOT NULL, \-- e.g. JOB-A7K92
>
> artisan\_id UUID REFERENCES users(id),
>
> client\_id UUID REFERENCES users(id),
>
> title TEXT NOT NULL,
>
> description TEXT,
>
> total\_amount INTEGER NOT NULL, \-- in cents (Ksh × 100)
>
> platform\_fee\_pct DECIMAL DEFAULT 2.5,
>
> state TEXT NOT NULL DEFAULT \'DRAFT\',
>
> deadline TIMESTAMPTZ,
>
> delivered\_at TIMESTAMPTZ,
>
> completed\_at TIMESTAMPTZ,
>
> deposit\_expiry\_job\_id TEXT, \-- BullMQ job ID for cancellation
>
> approval\_timer\_job\_id TEXT, \-- BullMQ job ID for cancellation
>
> dispute\_sla\_job\_id TEXT,
>
> delivery\_notes TEXT,
>
> delivery\_photo\_urls TEXT\[\],
>
> created\_at TIMESTAMPTZ DEFAULT NOW()
>
> );
>
> CREATE INDEX idx\_jobs\_artisan ON jobs(artisan\_id);
>
> CREATE INDEX idx\_jobs\_client ON jobs(client\_id);
>
> CREATE INDEX idx\_jobs\_state ON jobs(state);

**13.3 escrow\_ledger**
-----------------------

> CREATE TABLE escrow\_ledger (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> job\_id UUID REFERENCES jobs(id) NOT NULL,
>
> type TEXT NOT NULL CHECK (type IN (\'credit\', \'debit\')),
>
> amount INTEGER NOT NULL, \-- in cents, always positive
>
> mpesa\_ref TEXT UNIQUE, \-- M-Pesa TransID, UNIQUE = idempotency key
>
> description TEXT, \-- deposit\_50pct \| balance\_50pct \|
> milestone\_release \| payout \| refund \| fee
>
> created\_at TIMESTAMPTZ DEFAULT NOW()
>
> );
>
> \-- Balance view: never query this directly, use the view
>
> CREATE VIEW escrow\_balances AS
>
> SELECT job\_id,
>
> SUM(CASE WHEN type=\'credit\' THEN amount ELSE 0 END) AS
> total\_credited,
>
> SUM(CASE WHEN type=\'debit\' THEN amount ELSE 0 END) AS
> total\_debited,
>
> SUM(CASE WHEN type=\'credit\' THEN amount ELSE -amount END) AS balance
>
> FROM escrow\_ledger
>
> GROUP BY job\_id;

**13.4 milestones**
-------------------

> CREATE TABLE milestones (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> job\_id UUID REFERENCES jobs(id) NOT NULL,
>
> title TEXT NOT NULL,
>
> amount INTEGER NOT NULL, \-- in cents
>
> status TEXT DEFAULT \'pending\', \-- pending\|complete\|released
>
> completed\_at TIMESTAMPTZ,
>
> released\_at TIMESTAMPTZ
>
> );

**13.5 payments**
-----------------

> CREATE TABLE payments (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> job\_id UUID REFERENCES jobs(id),
>
> type TEXT NOT NULL, \-- c2b \| stk\_push \| b2c
>
> direction TEXT NOT NULL, \-- inbound \| outbound
>
> mpesa\_ref TEXT UNIQUE NOT NULL, \-- Safaricom TransID
>
> phone TEXT NOT NULL,
>
> amount INTEGER NOT NULL,
>
> status TEXT DEFAULT \'confirmed\',
>
> raw\_payload JSONB, \-- full Safaricom callback stored for audit
>
> created\_at TIMESTAMPTZ DEFAULT NOW()
>
> );

**13.6 disputes**
-----------------

> CREATE TABLE disputes (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> job\_id UUID REFERENCES jobs(id) UNIQUE NOT NULL,
>
> raised\_by UUID REFERENCES users(id),
>
> reason TEXT NOT NULL,
>
> description TEXT,
>
> client\_evidence TEXT\[\], \-- S3 URLs
>
> artisan\_evidence TEXT\[\], \-- from delivery photos
>
> resolution TEXT, \-- artisan\_full\|client\_full\|split
>
> split\_artisan\_pct DECIMAL,
>
> resolution\_note TEXT,
>
> resolved\_by UUID REFERENCES users(id),
>
> sla\_job\_id TEXT,
>
> created\_at TIMESTAMPTZ DEFAULT NOW(),
>
> resolved\_at TIMESTAMPTZ
>
> );

**13.7 reputation\_scores**
---------------------------

> CREATE TABLE reputation\_scores (
>
> id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
>
> artisan\_id UUID REFERENCES users(id) NOT NULL,
>
> score INTEGER NOT NULL, \-- 0-100
>
> jobs\_completed INTEGER DEFAULT 0,
>
> on\_time\_rate DECIMAL,
>
> dispute\_rate DECIMAL,
>
> avg\_rating DECIMAL,
>
> computed\_at TIMESTAMPTZ DEFAULT NOW()
>
> );
>
> CREATE INDEX idx\_rep\_artisan ON reputation\_scores(artisan\_id,
> computed\_at DESC);
>
> \-- Latest score view
>
> CREATE VIEW artisan\_reputation AS
>
> SELECT DISTINCT ON (artisan\_id) \* FROM reputation\_scores
>
> ORDER BY artisan\_id, computed\_at DESC;

**14. Event Bus --- Service Integration Map**
=============================================

All inter-service communication that does not require a synchronous
response uses Redis Streams as the event bus. The table below is the
definitive integration map: every event, its publisher, and every
service that consumes it.

  ----------------------------- ------------------- --------------------------------------------------------------------------------------------------------------------------------------
  **Event name**                **Publisher**       **Consumers + action**
  job.created                   Job Service         Notification Svc: send quote WhatsApp + SMS to client
  job.accepted                  Job Service         Payment Svc: initiate STK Push to client for 50% deposit; Scheduler: start 72hr deposit expiry timer
  payment.deposit.confirmed     Payment Service     Escrow Engine: credit ledger; Job Service: transition to ACTIVE; Notification Svc: receipt to both parties
  job.delivered                 Job Service         Notification Svc: approval card to client; Scheduler: start 48hr auto-approve timer; cancel deposit expiry timer
  job.approved                  Job Service         Payment Svc: STK Push to client for balance; Scheduler: cancel approval timer
  payment.balance.confirmed     Payment Service     Escrow Engine: credit balance to ledger; Payment Svc: initiate B2C to artisan
  payment.b2c.confirmed         Payment Service     Escrow Engine: debit payout from ledger + debit fee; Job Service: transition to COMPLETE; Reputation Svc: recompute score
  job.completed                 Job Service         Notification Svc: completion receipt + rating request to both parties
  job.disputed                  Job Service         Dispute Svc: open case; Escrow Engine: freeze balance; Notification Svc: alert both parties + admin; Scheduler: start 72hr SLA timer
  dispute.resolved              Dispute Service     Escrow Engine: execute release; Payment Svc: B2C for artisan and/or refund for client; Notification Svc: outcome to both parties
  payment.stk.failed            Payment Service     Notification Svc: send Paybill fallback SMS; Scheduler: queue STK retry in 10 minutes
  user.artisan.approved         User Service        Notification Svc: welcome SMS to artisan
  reputation.score.updated      Reputation Svc      User Service: update tier if threshold crossed; Notification Svc: tier upgrade SMS if applicable
  timer.deposit\_expired        Scheduler Service   Job Service: transition to CANCELLED; Notification Svc: notify both parties
  timer.approval\_expired       Scheduler Service   Job Service: call auto-approve; Notification Svc: SMS client explaining auto-approve
  timer.dispute\_sla\_expired   Scheduler Service   Dispute Svc: auto-resolve in favour of client; same flow as dispute.resolved
  ----------------------------- ------------------- --------------------------------------------------------------------------------------------------------------------------------------

**15. External API Integrations**
=================================

**15.1 M-Pesa Daraja 2.0**
--------------------------

### **Setup steps (one-time, in Daraja Portal)**

21. Create a Safaricom Developer account and register Fundi Pay as an
    app

22. Register the C2B Paybill: go to Register C2B URLs and provide the
    ValidationURL and ConfirmationURL

23. Generate OAuth token endpoint: POST
    https://sandbox.safaricom.co.ke/oauth/v1/generate (use Basic auth
    with Consumer Key + Secret)

24. All subsequent API calls include Authorization: Bearer {token} in
    the header

25. For production: apply for Go-Live, provide business documentation,
    and Safaricom assigns a live Paybill number

### **C2B RegisterURL request body**

> {
>
> \"ShortCode\": \"{paybill\_number}\",
>
> \"ResponseType\": \"Completed\",
>
> \"ConfirmationURL\":
> \"https://api.fundipay.co.ke/webhook/mpesa/confirmation\",
>
> \"ValidationURL\":
> \"https://api.fundipay.co.ke/webhook/mpesa/validation\"
>
> }

### **STK Push request body**

> {
>
> \"BusinessShortCode\": \"{paybill}\",
>
> \"Password\": \"{base64(paybill + passkey + timestamp)}\",
>
> \"Timestamp\": \"20250410120000\",
>
> \"TransactionType\": \"CustomerPayBillOnline\",
>
> \"Amount\": 6000,
>
> \"PartyA\": \"254712345678\", // client phone
>
> \"PartyB\": \"{paybill}\",
>
> \"PhoneNumber\": \"254712345678\",
>
> \"CallBackURL\":
> \"https://api.fundipay.co.ke/webhook/mpesa/stk-callback\",
>
> \"AccountReference\": \"JOB-A7K92\",
>
> \"TransactionDesc\": \"Balance payment for {job\_title}\"
>
> }

### **B2C request body**

> {
>
> \"InitiatorName\": \"fundipay\_api\",
>
> \"SecurityCredential\": \"{encrypted\_credential}\",
>
> \"CommandID\": \"BusinessPayment\",
>
> \"Amount\": 11700, // 97.5% of Ksh 12,000
>
> \"PartyA\": \"{paybill}\",
>
> \"PartyB\": \"254700123456\", // artisan phone
>
> \"Remarks\": \"FundiPay: {artisan\_name} --- JOB-A7K92\",
>
> \"QueueTimeOutURL\":
> \"https://api.fundipay.co.ke/webhook/mpesa/b2c-timeout\",
>
> \"ResultURL\": \"https://api.fundipay.co.ke/webhook/mpesa/b2c-result\"
>
> }

**15.2 Africa\'s Talking**
--------------------------

### **SMS**

Fundi Pay uses the Africa\'s Talking SMS API for all outbound SMS
messages. The Notification Service initialises the AT SDK with the API
key and username. All outgoing messages are sent from a registered
shortcode or sender ID (FundiPay). Delivery receipts are received via a
webhook configured in the AT dashboard.

### **USSD**

The USSD shortcode \*384\*FUNDI\# is registered in the AT dashboard with
the Callback URL pointing to POST /ussd/callback on the USSD Service.
Africa\'s Talking calls this URL on every user keypress, passing the
sessionId, phoneNumber, serviceCode, and text (cumulative input). The
USSD Service returns either CON {menu\_text} (continue) or END {message}
(terminate session).

**15.3 IPRS (National ID Verification)**
----------------------------------------

The IPRS API is the Kenya government\'s Integrated Population
Registration System. Fundi Pay calls it during artisan onboarding to
verify that the submitted name and national ID number match government
records. The API is accessed via the eCitizen developer portal. The call
is synchronous during onboarding --- if IPRS is down, the application is
queued and the artisan is notified to check back in 24 hours.

**15.4 S3-Compatible Object Storage**
-------------------------------------

Job delivery photos and dispute evidence are stored in an S3-compatible
bucket (AWS S3 or Cloudflare R2 for cost efficiency). Files are uploaded
directly from the PWA to S3 using pre-signed URLs generated by the
backend --- the file bytes never pass through the API servers. All
stored files are private. Access is via 1-hour time-limited signed URLs
generated fresh each time the frontend needs to display an image.

**16. Technology Stack**
========================

  ------------------- ---------------------------- --------------------------------------------------------------------------------------------------------------------
  **Layer**           **Choice**                   **Rationale**
  Backend runtime     Node.js 20 LTS + Fastify     Fast to scaffold; excellent M-Pesa SDK ecosystem; async I/O ideal for webhook-heavy workloads
  Database            PostgreSQL 16                ENUM types for state machine; UNIQUE constraint for idempotency; JSON for raw payloads; mature and reliable
  ORM                 Prisma                       Type-safe schema; migrations tracked in git; generated client eliminates SQL injection risk
  Cache + sessions    Redis 7 (Upstash)            USSD sessions (TTL); OTP storage; escrow locks; BullMQ job queues
  Job queues          BullMQ                       Built on Redis; delayed jobs for timers; retry with backoff; job ID trackable for cancellation
  Event bus           Redis Streams                Same Redis instance; consumer groups per service; persistent log; sufficient for hackathon + early production
  Frontend            React 18 + Vite + Tailwind   PWA manifest for installability; fast builds; wide component ecosystem
  Real-time updates   Socket.IO                    WebSocket with fallback; used for live escrow balance updates in dashboard
  Object storage      Cloudflare R2                S3-compatible; zero egress fees; ideal for photo-heavy workload
  Hosting             Railway.app                  One-click Postgres + Redis + Node; free tier sufficient for hackathon; easy env var management
  Local tunnelling    ngrok                        Expose localhost to Safaricom and AT webhooks during development; free tier adequate
  SMS + USSD          Africa\'s Talking            Kenya-native; free sandbox; unified SMS + USSD billing; delivery receipts; Kenyan phone number formatting built in
  Auth                OTP via AT + JWT (RS256)     No passwords; phone number as identity; RS256 allows token verification without secret sharing between services
  ID verification     IPRS via eCitizen API        Government authority; no alternative for Kenya national ID verification
  ------------------- ---------------------------- --------------------------------------------------------------------------------------------------------------------

**17. Environment Variables**
=============================

All secrets are stored as environment variables. Never commit these to
git. For Railway deployment, set via the Railway dashboard.

> \# M-Pesa Daraja
>
> MPESA\_CONSUMER\_KEY=
>
> MPESA\_CONSUMER\_SECRET=
>
> MPESA\_PAYBILL=
>
> MPESA\_PASSKEY=
>
> MPESA\_INITIATOR\_NAME=
>
> MPESA\_SECURITY\_CREDENTIAL=
>
> MPESA\_ENV=sandbox \# or production
>
> \# Africa\'s Talking
>
> AT\_API\_KEY=
>
> AT\_USERNAME=
>
> AT\_SENDER\_ID=FundiPay
>
> AT\_USSD\_CODE=\*384\*FUNDI\#
>
> \# Database
>
> DATABASE\_URL=postgresql://user:pass\@host:5432/fundipay
>
> REDIS\_URL=redis://default:pass\@host:6379
>
> \# Auth
>
> JWT\_PRIVATE\_KEY= \# RS256 PEM private key
>
> JWT\_PUBLIC\_KEY= \# RS256 PEM public key
>
> JWT\_EXPIRY=86400 \# 24 hours in seconds
>
> \# Storage
>
> R2\_ACCOUNT\_ID=
>
> R2\_ACCESS\_KEY\_ID=
>
> R2\_SECRET\_ACCESS\_KEY=
>
> R2\_BUCKET\_NAME=fundipay-media
>
> \# IPRS
>
> IPRS\_API\_URL=
>
> IPRS\_API\_KEY=
>
> \# App
>
> APP\_URL=https://fundipay.co.ke
>
> API\_URL=https://api.fundipay.co.ke
>
> PLATFORM\_FEE\_PCT=2.5
>
> MAX\_JOB\_VALUE\_STANDARD=5000000 \# Ksh 50,000 in cents

**18. Hackathon Build Sequence**
================================

For a 48-hour hackathon build, prioritise the core escrow loop first.
Everything else is demonstrable with mocked data if time runs out.

+----------------------------------------------------------------------+
| **Phase 1 (0--8 hrs): Core escrow loop --- must work**               |
|                                                                      |
| \(1\) PostgreSQL schema with jobs, escrow\_ledger, users, payments   |
| tables. (2) C2B Paybill webhook --- receive payment, credit ledger,  |
| transition job to ACTIVE. (3) Artisan submits delivery → job         |
| transitions to PENDING\_APPROVAL. (4) Client approves → STK Push     |
| fires → on confirm, B2C payout fires. (5) Bursar dashboard showing   |
| live escrow balance via WebSocket.                                   |
+----------------------------------------------------------------------+

+----------------------------------------------------------------------+
| **Phase 2 (8--20 hrs): Full happy path + USSD**                      |
|                                                                      |
| \(1\) USSD menu: balance check + delivery confirm + approval. (2)    |
| WhatsApp approval card with buttons. (3) 48hr auto-approve BullMQ    |
| timer. (4) SMS notifications at every state transition. (5)          |
| Reputation score computation after job completion. (6) Client PWA:   |
| quote review + STK Push approve flow.                                |
+----------------------------------------------------------------------+

+----------------------------------------------------------------------+
| **Phase 3 (20--36 hrs): Dispute + edge cases**                       |
|                                                                      |
| \(1\) Dispute form + evidence photo upload to R2. (2) Admin portal   |
| dispute queue + resolution form. (3) 72hr SLA auto-refund timer. (4) |
| STK Push retry on failure + Paybill fallback SMS. (5) Artisan        |
| onboarding + IPRS verification. (6) Milestone partial release flow.  |
+----------------------------------------------------------------------+

+----------------------------------------------------------------------+
| **Phase 4 (36--48 hrs): Demo polish + pitch**                        |
|                                                                      |
| \(1\) Seed demo data: 3 artisans, 5 jobs in various states. (2) Demo |
| script: create job → pay deposit → submit delivery → approve →       |
| payout. (3) Mobile-optimised PWA layout. (4) Revenue model slide:    |
| 2.5% platform fee on Ksh 2.4M artisan market = \~Ksh 300M TAM. (5)   |
| Pitch deck.                                                          |
+----------------------------------------------------------------------+

**19. Live Demo Script (3-minute flow)**
========================================

This is the exact sequence to demonstrate at the hackathon presentation.
Rehearse it until each step takes under 30 seconds.

26. **Artisan creates a quote (30s):** Open artisan PWA on phone. Fill
    in: Client phone: 0712345678, Job: Mahogany dining table, Price: Ksh
    12,000. Submit. Client phone receives WhatsApp card immediately.

27. **Client accepts and pays deposit (45s):** Open client PWA (or
    WhatsApp). Tap Accept quote. M-Pesa STK Push appears on client
    phone. Enter PIN. Artisan PWA updates in real time: Ksh 6,000 locked
    in escrow.

28. **Artisan delivers (20s):** Tap Submit delivery. Upload 2 photos.
    Add note. Client immediately receives WhatsApp approval card with
    photos and Approve / Dispute buttons.

29. **Client approves and pays balance (40s):** Client taps Approve in
    WhatsApp. STK Push for Ksh 6,000 appears. Enter PIN. Artisan sees
    Ksh 11,700 received via M-Pesa within 30 seconds (Ksh 12,000 minus
    2.5% fee = Ksh 300).

30. **Show dispute scenario (30s):** In a second browser tab,
    demonstrate a job in DISPUTED state. Show the admin portal dispute
    queue with both parties\' evidence side by side. Click Resolve:
    Release to artisan. B2C fires.

31. **Show USSD on feature phone (15s):** Dial \*384\*FUNDI\# live.
    Navigate to Check escrow balance. Enter job reference. Show Ksh 0
    balance on the completed job.

+----------------------------------------------------------------------+
| **Demo tip: Closing line**                                           |
|                                                                      |
| \"Every year, 2.4 million Kenyan artisans lose work or money because |
| there is no neutral party they can both trust. Fundi Pay is that     |
| party --- not a bank, not a lawyer, just M-Pesa holding the money    |
| until both sides are happy.\"                                        |
+----------------------------------------------------------------------+

Fundi Pay · Technical Specification v1.0 · Money in Motion Hackathon ·
M-Pesa Africa + GOMYCODE Kenya
