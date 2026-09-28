/**
 * FHIR R4 CarePlan resource type.
 * Describes the intention of how one or more practitioners intend to deliver care.
 * Spec: https://hl7.org/fhir/R4/careplan.html
 *
 * Use case: quản lý bệnh mãn tính (tiểu đường, tim mạch, ung thư).
 */

import type {
  DomainResource,
  Identifier,
  CodeableConcept,
  Reference,
  Period,
  Quantity,
} from './base-resource.js';

/** Trạng thái kế hoạch chăm sóc (FHIR R4 §11.4.1.2) */
export type CarePlanStatus =
  'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';

/** Mục đích/ý định của kế hoạch (FHIR R4 §11.4.1.3) */
export type CarePlanIntent = 'proposal' | 'plan' | 'order' | 'option' | 'directive';

/** Trạng thái chi tiết hoạt động trong kế hoạch */
export type CarePlanActivityStatus =
  | 'not-started'
  | 'scheduled'
  | 'in-progress'
  | 'on-hold'
  | 'completed'
  | 'cancelled'
  | 'stopped'
  | 'unknown'
  | 'entered-in-error';

/** Chi tiết một hoạt động trong kế hoạch chăm sóc */
export interface CarePlanActivityDetail {
  /** Loại hoạt động — ví dụ: 'drug-administration', 'procedure' */
  kind?: string;
  instantiatesCanonical?: string[];
  instantiatesUri?: string[];
  /** Mã hóa hoạt động */
  code?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  goal?: Reference[];
  /** Trạng thái thực hiện */
  status: CarePlanActivityStatus;
  statusReason?: CodeableConcept;
  doNotPerform?: boolean;
  scheduledString?: string;
  scheduledPeriod?: Period;
  location?: Reference;
  performer?: Reference[];
  productCodeableConcept?: CodeableConcept;
  productReference?: Reference;
  dailyAmount?: Quantity;
  quantity?: Quantity;
  description?: string;
}

/** Một hoạt động cụ thể trong kế hoạch chăm sóc */
export interface CarePlanActivity {
  outcomeCodeableConcept?: CodeableConcept[];
  outcomeReference?: Reference[];
  progress?: Array<{ text: string; time?: string }>;
  /** Tham chiếu đến resource chi tiết (ServiceRequest, MedicationRequest, v.v.) */
  reference?: Reference;
  detail?: CarePlanActivityDetail;
}

/**
 * FHIR R4 CarePlan resource.
 * Required: status, intent, subject.
 * Must-support: category, title, period, activity.
 */
export interface CarePlan extends DomainResource {
  readonly resourceType: 'CarePlan';
  identifier?: Identifier[];
  instantiatesCanonical?: string[];
  instantiatesUri?: string[];
  basedOn?: Reference[];
  replaces?: Reference[];
  partOf?: Reference[];
  /** Trạng thái kế hoạch — bắt buộc */
  status: CarePlanStatus;
  /** Mục đích/ý định — bắt buộc */
  intent: CarePlanIntent;
  /** Phân loại kế hoạch */
  category?: CodeableConcept[];
  /** Tiêu đề ngắn gọn */
  title?: string;
  /** Mô tả nội dung kế hoạch */
  description?: string;
  /** Bệnh nhân là đối tượng — bắt buộc */
  subject: Reference;
  /** Cuộc gặp liên quan */
  encounter?: Reference;
  /** Khoảng thời gian áp dụng kế hoạch */
  period?: Period;
  /** Ngày tạo (ISO 8601 datetime) */
  created?: string;
  /** Tác giả kế hoạch */
  author?: Reference;
  contributor?: Reference[];
  /** Đội điều trị liên quan */
  careTeam?: Reference[];
  /** Vấn đề/chẩn đoán được giải quyết */
  addresses?: Reference[];
  supportingInfo?: Reference[];
  /** Mục tiêu điều trị */
  goal?: Reference[];
  /** Danh sách hoạt động trong kế hoạch */
  activity?: CarePlanActivity[];
  note?: Array<{ text: string }>;
}
