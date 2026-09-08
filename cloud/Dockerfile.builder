FROM python:3.13-slim
WORKDIR /work
COPY cloud/requirements-build.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY cloud/tools/build_model.py ./build_model.py
ENTRYPOINT ["python", "build_model.py", "--cache", "/cache", "--output", "/models/malecns-full"]
