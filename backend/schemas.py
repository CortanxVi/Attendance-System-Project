from pydantic import BaseModel
from typing import List, Optional
from datetime import date
from models import AttendanceStatus

class StudentBase(BaseModel):
    student_code: str
    first_name: str
    last_name: str
    major: Optional[str] = None

class StudentCreate(StudentBase):
    pass

class Student(StudentBase):
    id: int
    class Config:
        from_attributes = True

class CourseBase(BaseModel):
    course_code: str
    course_name: str

class CourseCreate(CourseBase):
    pass

class Course(CourseBase):
    id: int
    class Config:
        from_attributes = True

class ImportResponse(BaseModel):
    status: str
    imported_count: int
    message: str

class AttendanceSummary(BaseModel):
    student_id: int
    student_code: str
    first_name: str
    last_name: str
    present: int
    late: int
    absent: int
    leave: int

class AttendanceCheckIn(BaseModel):
    session_id: str
    student_uuid: str
    status: str = "present"
    method: str
    similarity_score: Optional[float] = None
