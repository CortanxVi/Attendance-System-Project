from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import pandas as pd
import io

router = APIRouter(prefix="/api/import", tags=["Import"])

@router.post("/students/{course_id}")
async def import_students(course_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a CSV file.")
    
    # Check if course exists
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    content = await file.read()
    try:
        # read csv
        df = pd.read_csv(io.StringIO(content.decode("utf-8")))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading CSV: {str(e)}")
    
    # Expected columns: student_code, first_name, last_name, major
    required_cols = ["student_code", "first_name", "last_name"]
    for col in required_cols:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Missing required column: {col}")
    
    imported_count = 0
    for _, row in df.iterrows():
        # Check if student exists
        student = db.query(models.Student).filter(models.Student.student_code == str(row['student_code'])).first()
        if not student:
            student = models.Student(
                student_code=str(row['student_code']),
                first_name=row['first_name'],
                last_name=row['last_name'],
                major=row.get('major', None)
            )
            db.add(student)
            db.flush() # get student.id
        
        # Check enrollment
        enrollment = db.query(models.Enrollment).filter(
            models.Enrollment.course_id == course_id,
            models.Enrollment.student_id == student.id
        ).first()
        
        if not enrollment:
            enrollment = models.Enrollment(course_id=course_id, student_id=student.id)
            db.add(enrollment)
            imported_count += 1
            
    db.commit()
    
    return {"status": "success", "imported_count": imported_count, "message": f"Successfully imported {imported_count} students."}
