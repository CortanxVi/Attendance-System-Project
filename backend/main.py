from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, SessionLocal
import models
from routers import import_api, report_api, attendance_api

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Attendance System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(import_api.router)
app.include_router(report_api.router)
app.include_router(attendance_api.router)

@app.get("/")
def root():
    return {"message": "Welcome to Attendance System API"}

# Create dummy course for testing
@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    course = db.query(models.Course).filter(models.Course.course_code == "CS101").first()
    if not course:
        course = models.Course(course_code="CS101", course_name="Introduction to Computer Science")
        db.add(course)
        db.commit()
    db.close()
