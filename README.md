# Accounting OS — ระบบบริหารงานบัญชี–ภาษีและติดตามงาน

ระบบ On-Premise/Self-Hosted สำหรับสำนักงานบัญชี–ภาษีและงานนิติบุคคล

- สเปกหลัก: [docs/blueprint.md](docs/blueprint.md)
- แผนเฟส 1 (Core Operations): [docs/phase1-plan.md](docs/phase1-plan.md)

## กติกาของ repo
1. ใช้ Seed Data สมมติเท่านั้น ห้ามมีข้อมูลลูกค้าจริง
2. โค้ดห้ามเรียก External AI/API
3. ทุกตารางมี `tenant_id` และบังคับ PostgreSQL Row-Level Security พร้อมเทสต์ข้าม tenant
4. ข้อมูลสำคัญมีเวอร์ชันและ Audit Log ที่แก้ย้อนหลังไม่ได้ ผู้แก้ห้ามเป็นผู้อนุมัติรายการเดียวกัน
5. ทุก PR ต้องมีเทสต์ที่ผ่าน และอ้างถึงส่วนของพิมพ์เขียวที่ทำ
