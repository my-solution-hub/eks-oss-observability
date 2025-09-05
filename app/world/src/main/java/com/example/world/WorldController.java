package com.example.world;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class WorldController {
    private static final Logger logger = LoggerFactory.getLogger(WorldController.class);

    @GetMapping("/api/message")
    public String message() {
        logger.info("Received request for /api/message");
        String response = "World!";
        logger.info("Returning message response: {}", response);
        return response;
    }

    @GetMapping("/api/health")
    public String health() {
        logger.info("Received request for /api/health");
        String response = "OK";
        logger.info("Returning health response: {}", response);
        return response;
    }
}
