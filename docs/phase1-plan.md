# แผนเฟส 1 — Core Operations (Accounting OS)

อ้างอิง: พิมพ์เขียว ส่วนที่ 12 เฟส 1 — Login/สิทธิ์, Company/Person, Workflow, Checklist, Evidence, Review, SLA, Notification, Dashboard, Audit
เป้าหมายรับมอบ: "ใช้งานกับเคสนำร่องได้ครบวงจร" ด้วย Seed Data สมมติเท่านั้น ไม่มีการเรียก External AI/API

## สิ่งที่ "ไม่" อยู่ในเฟส 1 (ตามกฎข้อ 3 และส่วนที่ 12)
- Registration Wizard เต็มรูป, Form Mapping, ภาษีรายเดือน, Payment Tracking → เฟส 2
- Ollama/RAG/OCR, Root Cause Agent, Nextcloud → เฟส 3
- Private Mail, CCTV, สองไซต์/Failover → เฟส 4

## Tech stack ที่เสนอ (ยึดส่วนที่ 10)
| ชั้น | เลือกใช้ | เหตุผล |
|---|---|---|
| Backend | Node.js 22 + TypeScript + NestJS (Modular Monolith แยก domain เป็น module) | Phong เลือก 2026-10-26; REST + WebSocket Gateway |
| DB | PostgreSQL 16 + RLS (+ PgBouncer ใน compose) | ตามสเปก |
| Migration/Query | Kysely + migration เป็น SQL ตรง ๆ (node-postgres) | ควบคุม `SET LOCAL` ต่อ transaction และเขียน RLS policy/trigger ได้ชัด |
| Auth | OIDC abstraction; Keycloak ใน Docker Compose (Passkey/WebAuthn + OTP ตั้งค่าใน Keycloak) | ตามส่วนที่ 10; เทสต์ใช้ token ที่เซ็นในเครื่อง |
| Files | Storage interface + local/MinIO; DB เก็บ reference, checksum, version | ตามส่วนที่ 10 |
| Events | Redis Streams สำหรับ notification/escalation job | ตามส่วนที่ 10 |
| Frontend | React + Vite PWA (บาง ๆ ท้ายเฟส) ใช้ TypeScript และ type ร่วมกับ backend | ตามส่วนที่ 10 |
| AI (เฟส 3) | แยก service Python ภายในเครือข่ายเมื่อถึงเฟส 3 | ไม่ทำในเฟส 1 |
| Tests | Jest + Supertest กับ PostgreSQL จริง (ไม่ mock DB) — RLS ต้องเทสต์บน Postgres จริง | กฎข้อ 6–7 |
| CI | GitHub Actions + postgres service container | กฎข้อ 7 |

หลักความปลอดภัยที่ฝังตั้งแต่ PR แรก:
- แอปต่อ DB ด้วย role ที่ไม่ใช่ owner/superuser, ทุกตาราง `ENABLE` + `FORCE ROW LEVEL SECURITY` ด้วย `tenant_id = current_setting('app.tenant_id')`
- ตั้ง tenant ต่อ transaction ด้วย `SET LOCAL` เท่านั้น
- audit_logs: REVOKE UPDATE/DELETE + trigger ปฏิเสธ UPDATE/DELETE + hash chain ตรวจการปลอมแปลง
- Four-eyes บังคับที่ DB (CHECK/trigger: approved_by ≠ created_by/updated_by) ไม่ใช่แค่ในโค้ด

## ลำดับ PR (แต่ละ PR มีเทสต์ผ่าน + อ้างส่วนของพิมพ์เขียว)
| # | PR | ส่วนพิมพ์เขียว | เทสต์หลัก |
|---|---|---|---|
| 0 | Skeleton: โครง repo, Docker Compose (Postgres, PgBouncer, Redis, Keycloak), CI, lint, seed framework | 10, 1 (ส่งมอบ) | CI รันได้, healthcheck |
| 1 | Tenant/Identity + RLS: tenants, departments, users, roles, permissions, user_tenant_access, user_department_access; RBAC Level 1–4 + ABAC (department, classification) | 3, 11 | **บริษัท A มองไม่เห็น B** ทุกตาราง (เทสต์อัตโนมัติวนทุกตารางที่มี tenant_id), Staff เห็นเฉพาะงานตัวเอง |
| 2 | Audit + Versioning + Four-eyes: audit_logs (append-only), change_requests, รูปแบบ versioned record (effective_from/to, version) | 6, ข้อห้าม, 11 | UPDATE/DELETE audit ถูกปฏิเสธ, hash chain ตรวจพบการแก้, ผู้แก้อนุมัติเองไม่ได้ |
| 3 | Company/Person Master (ชุดข้อมูลขั้นต่ำ): companies, company_names, addresses, persons, person_documents, company_roles, directors, shareholders, share_allocations, signing_authorities | 4.1, 4.2 (กฎหุ้น/ทุน), 11 | แก้ข้อมูลต้องผ่าน change request, แสดงค่าเดิม/ใหม่/ผู้แก้/เหตุผล/ผู้อนุมัติ, กฎหุ้นรวม 100% |
| 4 | Workflow engine: service_types, workflow_templates, workflow_steps, step_dependencies, cases, case_steps, assignments; 13 สถานะมาตรฐาน + 4 แบบ dependency | 5 | state machine ห้ามข้ามสถานะผิด, Finish-to-Start/Parallel/Close-Blocked/Override by Approval |
| 5 | Checklist + Evidence + Review/Approval/Reject + Pre-submission Gate + Draft Isolation | 6 | Draft ใช้สร้างฉบับพร้อมยื่นไม่ได้, gate ปิดเมื่อหลักฐานไม่ครบ, ตรวจสองชั้น |
| 6 | SLA + Holidays + Notification (in-app + WebSocket) + Escalation + Current Accountability Owner + เหตุผลรอ (ลูกค้า/ราชการ/อนุมัติ/ระบบ/ผู้ปฏิบัติ) | 7, 12 (กำหนดเวลาตามกฎ+วันหยุด) | เปลี่ยนกฎ SLA/วันหยุดได้โดยไม่แก้โค้ด, ยกระดับตามความเสี่ยง, notification ไม่ข้าม tenant |
| 7 | Dashboard API: ภาพรวม, ความเสี่ยง, สาเหตุค้าง, คุณภาพ (อัตราตีกลับ), กำลังคน, drill-down ถึง timeline | 9, 8 (สูตรอัตราความผิดพลาด — คำนวณแบบไม่ใช้ AI) | ตัวเลข KPI ตรงกับ seed, แยก ผู้พบ/ผู้ถือครอง/ผู้ส่งต่อ |
| 8 | Frontend PWA ขั้นต่ำ: login, รายการงาน, หน้าเคส, approve/reject, notification, dashboard | 10 | E2E (Playwright) เคสนำร่องครบวงจร |
| 9 | Hardening: idempotency key (retry/duplicate), Backup/Restore test จริง, Audit Trail test, เอกสารติดตั้ง/ส่งมอบ | 12 Acceptance, 1 (ส่งมอบ) | restore ได้จริง, duplicate request ไม่สร้าง audit/สถานะซ้ำ |

## สมมติฐานแทนข้อมูลที่ยังไม่ตัดสินใจ (ส่วนที่ 13)
ใช้ค่าสมมติใน seed เพื่อให้เดินงานได้ และเปลี่ยนภายหลังผ่าน config/template:
- Workflow นำร่อง 3 แบบ: ประกันสังคมรายเดือน, ภ.ง.ด.1, ภ.พ.30 (เป็นแค่ template ของ workflow ยังไม่ทำ form mapping)
- บริษัทสมมติ 2 tenant (A, B), 2 แผนก, ผู้ใช้ทุกระดับ, SLA ตัวอย่าง, วันหยุดราชการตัวอย่าง
- ไม่ใช้ชื่อ/เลขประจำตัวจริงใด ๆ — เลขผู้เสียภาษีสมมติที่ checksum ผ่านแต่ขึ้นต้นด้วย prefix ทดสอบ
