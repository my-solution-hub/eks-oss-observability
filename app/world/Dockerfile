FROM openjdk:17-jdk-slim
COPY target/world-0.0.1-SNAPSHOT.jar app.jar
COPY agent/aws-opentelemetry-agent.jar opentelemetry-javaagent.jar
EXPOSE 8081
ENTRYPOINT ["java", "-javaagent:opentelemetry-javaagent.jar", "-jar", "/app.jar"]
