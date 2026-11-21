import type { ClassGrade, IndianBoard, UserRole } from '../types/auth.ts';

export const INDIAN_BOARDS: {
  id: IndianBoard;
  label: string;
  full: string;
  type: 'national' | 'state' | 'other';
}[] = [
  { id: 'CBSE', label: 'CBSE', full: 'Central Board of Secondary Education (All India & Overseas)', type: 'national' },
  { id: 'CISCE', label: 'CISCE', full: 'Council for the Indian School Certificate Examinations', type: 'national' },
  { id: 'ICSE', label: 'ICSE (Class 9-10)', full: 'Indian Certificate of Secondary Education', type: 'national' },
  { id: 'ISC', label: 'ISC (Class 11-12)', full: 'Indian School Certificate', type: 'national' },
  { id: 'StateBoard', label: 'State Boards', full: 'All Indian State Boards (Maharashtra, UP, Bihar, Karnataka, etc.)', type: 'state' },
  { id: 'Other', label: 'Other / Foundation', full: 'Other Curricula / International Baccalaureate / Cambridge', type: 'other' },
];

export const INDIAN_STATES: string[] = [
  'Delhi (NCT)',
  'Maharashtra',
  'Uttar Pradesh',
  'Karnataka',
  'Tamil Nadu',
  'Telangana',
  'Andhra Pradesh',
  'West Bengal',
  'Gujarat',
  'Rajasthan',
  'Madhya Pradesh',
  'Bihar',
  'Punjab',
  'Haryana',
  'Kerala',
  'Odisha',
  'Assam',
  'Jharkhand',
  'Chhattisgarh',
  'Uttarakhand',
  'Himachal Pradesh',
  'Jammu & Kashmir',
  'Goa',
  'Tripura',
  'Meghalaya',
  'Manipur',
  'Nagaland',
  'Chandigarh',
  'Other / Overseas Indian',
];

export const CLASS_GRADES: ClassGrade[] = [
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

export const AVAILABLE_SUBJECTS_BY_GRADE: Record<string, string[]> = {
  'Class 6': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'],
  'Class 7': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'],
  'Class 8': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi', 'Computer Studies'],
  'Class 9': ['Mathematics', 'Science', 'Social Science', 'English Language & Literature', 'Hindi Course A/B', 'Information Technology'],
  'Class 10': ['Mathematics (Standard/Basic)', 'Science', 'Social Science', 'English Language & Literature', 'Hindi Course A/B', 'Artificial Intelligence'],
  'Class 11': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science', 'English Core', 'Accountancy', 'Economics', 'Business Studies'],
  'Class 12': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science', 'English Core', 'Accountancy', 'Economics', 'Business Studies'],
};

export const POPULAR_LEARNING_GOALS: string[] = [
  'Score 95%+ in Upcoming Board & School Exams',
  'Organize Official Datesheet & Prep Timeline',
  'Solve Board-Pattern Sample Papers Under Timed Conditions',
  'Identify High-Priority Revision Gaps Before Exam Week',
  'Clear Exam Doubts & Conceptual Weaknesses Early',
];

export function hasRoleAccess(userRole: UserRole, allowedRoles?: UserRole[]): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  if (userRole === 'admin') return true;
  return allowedRoles.includes(userRole);
}
