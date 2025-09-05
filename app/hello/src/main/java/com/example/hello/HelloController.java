package com.example.hello;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

@RestController
public class HelloController {
    private static final Logger logger = LoggerFactory.getLogger(HelloController.class);

    @Autowired
    private RestTemplate restTemplate;

    @Value("${world.service.url:http://world:8081}")
    private String worldServiceUrl;

    @GetMapping("/api/greeting")
    public String greeting() {
        logger.info("Received request for /api/greeting");
        try {
            String worldResponse = restTemplate.getForObject(worldServiceUrl + "/api/message", String.class);
            logger.info("Successfully called world service /api/message, response: {}", worldResponse);
            return "Hello " + worldResponse;
        } catch (Exception e) {
            logger.error("Error calling world service /api/message", e);
            return "Hello World (fallback)";
        }
    }

    @GetMapping("/api/status")
    public String status() {
        logger.info("Received request for /api/status");
        try {
            String worldResponse = restTemplate.getForObject(worldServiceUrl + "/api/health", String.class);
            logger.info("Successfully called world service /api/health, response: {}", worldResponse);
            return "Hello service is running, World service: " + worldResponse;
        } catch (Exception e) {
            logger.error("Error calling world service /api/health", e);
            return "Hello service is running, World service: unavailable";
        }
    }
}
