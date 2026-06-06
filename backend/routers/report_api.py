from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
import models
import pandas as pd
import io

router = APIRouter(prefix="/api/report", tags=["Report"])

def get_attendance_data(course_id: int, db: Session):
    # This will return a list of dicts with student attendance summary
    enrollments = db.query(models.Enrollment).filter(models.Enrollment.course_id == course_id).all()
    
    data = []
    for enr in enrollments:
        student = enr.student
        
        # calculate stats
        present = db.query(func.count(models.AttendanceRecord.id)).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.session_id.in_(
                db.query(models.AttendanceSession.id).filter(models.AttendanceSession.course_id == course_id)
            ),
            models.AttendanceRecord.status == models.AttendanceStatus.PRESENT
        ).scalar()

        late = db.query(func.count(models.AttendanceRecord.id)).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.session_id.in_(
                db.query(models.AttendanceSession.id).filter(models.AttendanceSession.course_id == course_id)
            ),
            models.AttendanceRecord.status == models.AttendanceStatus.LATE
        ).scalar()
        
        absent = db.query(func.count(models.AttendanceRecord.id)).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.session_id.in_(
                db.query(models.AttendanceSession.id).filter(models.AttendanceSession.course_id == course_id)
            ),
            models.AttendanceRecord.status == models.AttendanceStatus.ABSENT
        ).scalar()
        
        leave = db.query(func.count(models.AttendanceRecord.id)).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.session_id.in_(
                db.query(models.AttendanceSession.id).filter(models.AttendanceSession.course_id == course_id)
            ),
            models.AttendanceRecord.status == models.AttendanceStatus.LEAVE
        ).scalar()
        
        data.append({
            "student_id": student.id,
            "student_code": student.student_code,
            "first_name": student.first_name,
            "last_name": student.last_name,
            "present": present,
            "late": late,
            "absent": absent,
            "leave": leave
        })
    return data

@router.get("/{course_id}/summary")
def get_summary(course_id: int, db: Session = Depends(get_db)):
    data = get_attendance_data(course_id, db)
    return {"status": "success", "data": data}

@router.get("/{course_id}/export/csv")
def export_csv(course_id: int, db: Session = Depends(get_db)):
    data = get_attendance_data(course_id, db)
    df = pd.DataFrame(data)
    
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=report_course_{course_id}.csv"
    return response

@router.get("/{course_id}/export/excel")
def export_excel(course_id: int, db: Session = Depends(get_db)):
    data = get_attendance_data(course_id, db)
    df = pd.DataFrame(data)
    
    stream = io.BytesIO()
    with pd.ExcelWriter(stream, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Attendance')
    
    stream.seek(0)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response.headers["Content-Disposition"] = f"attachment; filename=report_course_{course_id}.xlsx"
    return response

@router.get("/{course_id}/export/pdf")
def export_pdf(course_id: int, db: Session = Depends(get_db)):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
    from reportlab.lib import colors

    data = get_attendance_data(course_id, db)
    
    stream = io.BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=letter)
    elements = []
    
    # Table header
    table_data = [['Student Code', 'First Name', 'Last Name', 'Present', 'Late', 'Absent', 'Leave']]
    
    for row in data:
        table_data.append([
            row['student_code'], row['first_name'], row['last_name'],
            row['present'], row['late'], row['absent'], row['leave']
        ])
        
    t = Table(table_data)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.grey),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0,0), (-1,0), 12),
        ('BACKGROUND', (0,1), (-1,-1), colors.beige),
        ('GRID', (0,0), (-1,-1), 1, colors.black)
    ]))
    
    elements.append(t)
    doc.build(elements)
    
    stream.seek(0)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="application/pdf")
    response.headers["Content-Disposition"] = f"attachment; filename=report_course_{course_id}.pdf"
    return response
