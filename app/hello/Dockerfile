FROM openjdk:17-jdk-slim
COPY target/hello-0.0.1-SNAPSHOT.jar app.jar
COPY agent/aws-opentelemetry-agent.jar opentelemetry-javaagent.jar
EXPOSE 8080
ENTRYPOINT ["java", "-javaagent:opentelemetry-javaagent.jar", "-jar", "/app.jar"]
