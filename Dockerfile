# 大富豪オンライン 3D を Render の無料 Web Service（Docker）で動かす（Claude・2026-10-22）
# サーバーは Python の標準ライブラリだけ。追加の pip は要らない
FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
COPY --chown=user:user app/ /home/user/app/
USER user
ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1
# PORT は Render が渡す（無ければ app.py の既定 8123）
EXPOSE 10000
CMD ["python", "app.py"]
